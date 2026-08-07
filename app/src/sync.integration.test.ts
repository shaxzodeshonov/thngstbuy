/**
 * The whole path, end to end: the app's api client, over real HTTP, against the
 * real Express app, against real SQLite.
 *
 * The unit tests in sync.test.ts use a stand-in server, which proves the engine
 * obeys its own rules but not that those rules match the server's behaviour.
 * This file is where the two halves are checked against each other — especially
 * the replay cases, whose correctness depends on what the routes actually do
 * with a repeated write rather than on what this side assumes.
 */

import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'

let server: Server
let dir: string
let api: typeof import('./api').api
let ApiError: typeof import('./api').ApiError
let mirror: typeof import('./mirror').mirror
let outbox: typeof import('./outbox').outbox
let createSyncer: typeof import('./sync').createSyncer

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'thngstbuy-e2e-'))
  process.env.DB_FILE = join(dir, 'test.db')
  delete process.env.TURSO_DATABASE_URL
  // The rate limiter is per-IP and every request here comes from the same one.
  process.env.RATE_LIMIT_PER_MIN = '100000'
  process.env.NEW_LISTS_PER_HOUR = '100000'

  const { createApp } = await import('../../server/app.js')
  server = createServer(createApp())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const port = (server.address() as { port: number }).port
  // config.ts reads this at import time, so it must be set before the import.
  process.env.EXPO_PUBLIC_API_BASE = `http://127.0.0.1:${port}`

  ;({ api, ApiError } = await import('./api'))
  ;({ mirror } = await import('./mirror'))
  ;({ outbox } = await import('./outbox'))
  ;({ createSyncer } = await import('./sync'))
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows holds the database file open. The OS can have the directory.
  }
})

beforeEach(() => useAdapter(() => createNodeAdapter(':memory:')))

test('a list created on the server can be opened by the app', async () => {
  const created = await api.createList()
  expect(created.slug).toMatch(/^[0-9a-z]{12}$/)

  await mirror.adopt(created, created.slug)
  expect((await mirror.getList(created.slug)).items).toEqual([])
})

test('queued writes replay onto the real server in order', async () => {
  const { slug } = await api.createList()
  await mirror.adopt(await api.getList(slug), slug)

  const syncer = createSyncer(slug)
  const item = crypto.randomUUID()

  await mirror.addItem(slug, { id: item, name: 'Kettle' })
  await syncer.enqueue('addItem', item, { id: item, name: 'Kettle' })
  await syncer.enqueue('patchItem', item, { price: 200000, why: 'the old one leaks' })
  await syncer.cycle()

  expect(await outbox.count(slug)).toBe(0)

  const remote = await api.getList(slug)
  expect(remote.items).toHaveLength(1)
  expect(remote.items[0]).toMatchObject({
    id: item,
    name: 'Kettle',
    price: 200000,
    why: 'the old one leaks',
  })
})

test('the client’s item id is the one the server stores', async () => {
  // If this fails, every replayed add creates a duplicate row. It is the whole
  // reason react-native-get-random-values is a dependency.
  const { slug } = await api.createList()
  const item = crypto.randomUUID()

  await api.addItem(slug, { id: item, name: 'Kettle' })

  expect((await api.getList(slug)).items[0].id).toBe(item)
})

test('a replayed add does not duplicate the row', async () => {
  // What happens when a response is lost: the op is still in the outbox, so it
  // goes again. Exercises the ON CONFLICT DO NOTHING added to server/db.js.
  const { slug } = await api.createList()
  const item = crypto.randomUUID()

  await api.addItem(slug, { id: item, name: 'Kettle' })
  await api.patchItem(slug, item, { name: 'Electric kettle' })
  await api.addItem(slug, { id: item, name: 'Kettle' })

  const remote = await api.getList(slug)
  expect(remote.items).toHaveLength(1)
  // The retry carried the original name and must not have undone the edit.
  expect(remote.items[0].name).toBe('Electric kettle')
})

test('a queued edit to something already deleted is dropped, not retried', async () => {
  const { slug } = await api.createList()
  await mirror.adopt(await api.getList(slug), slug)

  const item = crypto.randomUUID()
  await api.addItem(slug, { id: item, name: 'Kettle' })
  await api.removeItem(slug, item)

  const syncer = createSyncer(slug)
  await syncer.enqueue('patchItem', item, { why: 'too late' })
  await syncer.cycle()

  expect(await outbox.count(slug)).toBe(0)
  expect(syncer.state().live).toBe(true)
})

test('two devices editing different fields both survive', async () => {
  // The property the whole offline design rests on, verified against the real
  // routes rather than against an assumption about them.
  const { slug } = await api.createList()
  const item = crypto.randomUUID()
  await api.addItem(slug, { id: item, name: 'Kettle' })

  await api.patchItem(slug, item, { price: 200000 })
  await api.patchItem(slug, item, { why: 'the old one leaks' })

  const remote = await api.getList(slug)
  expect(remote.items[0]).toMatchObject({ price: 200000, why: 'the old one leaks' })
})

test('the version moves when someone else writes, and the app notices', async () => {
  const { slug } = await api.createList()
  await mirror.adopt(await api.getList(slug), slug)

  const before = await mirror.lastVersion(slug)

  // Another device adds something.
  await api.addItem(slug, { id: crypto.randomUUID(), name: 'Lamp' })
  expect((await api.getVersion(slug)).version).toBeGreaterThan(before)

  await createSyncer(slug).cycle()

  expect((await mirror.getList(slug)).items.map((i) => i.name)).toEqual(['Lamp'])
})

test('a name that is taken comes back as a message rather than a crash', async () => {
  const first = await api.createList()
  const second = await api.createList()

  await api.renameList(first.slug, 'shaxzod')

  await expect(api.renameList(second.slug, 'shaxzod')).rejects.toBeInstanceOf(ApiError)
  await expect(api.renameList(second.slug, 'shaxzod')).rejects.toMatchObject({ status: 409 })
})

test('a renamed list is still reachable by its original link', async () => {
  const { slug: original } = await api.createList()
  await api.renameList(original, 'kitchen-things')

  // The promise the rename screen makes: a link already handed out keeps working.
  expect((await api.getList(original)).slug).toBe('kitchen-things')
})

test('opening a list that does not exist is a 404, which the app reads as missing', async () => {
  await expect(api.getList('nosuchlist99')).rejects.toMatchObject({ status: 404 })
})
