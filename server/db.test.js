import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * These run against a real SQLite file through the same file adapter local
 * development uses, so the statements under test are the statements that run.
 */

let dir

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thngstbuy-'))
  process.env.DB_FILE = join(dir, 'test.db')
  delete process.env.TURSO_DATABASE_URL
  // db.js memoises its adapter, so a new database needs a new module instance.
  vi.resetModules()
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Windows will not unlink the database while the adapter still holds it
    // open. The temp directory is the OS's problem after that.
  }
})

const LIST = 'abcdefghjkmn'
const ITEM = '11111111-1111-4111-8111-111111111111'

test('adding the same item id twice leaves one row', async () => {
  const db = await import('./db.js')
  await db.createList(LIST)
  const list = { id: LIST, slug: LIST }

  // What a replayed queue op looks like: the first add reached the server, its
  // response was lost, and the phone sent it again.
  await db.addItem(list.id, ITEM, 'Kettle')
  await db.addItem(list.id, ITEM, 'Kettle')

  const state = await db.readListById({ id: list.id, slug: list.slug })
  expect(state.items).toHaveLength(1)
  expect(state.items[0].name).toBe('Kettle')
})

test('a replayed add does not revert a patch that landed in between', async () => {
  const db = await import('./db.js')
  await db.createList(LIST)
  const list = { id: LIST, slug: LIST }

  await db.addItem(list.id, ITEM, 'Kettle')
  await db.patchItem(list.id, ITEM, { name: 'Electric kettle', price: 200000 })
  // The retry carries the original name, which must not overwrite the edit.
  await db.addItem(list.id, ITEM, 'Kettle')

  const state = await db.readListById({ id: list.id, slug: list.slug })
  expect(state.items[0].name).toBe('Electric kettle')
  expect(state.items[0].price).toBe(200000)
})

test('distinct item ids still both insert', async () => {
  const db = await import('./db.js')
  await db.createList(LIST)
  const list = { id: LIST, slug: LIST }

  await db.addItem(list.id, ITEM, 'Kettle')
  await db.addItem(list.id, '22222222-2222-4222-8222-222222222222', 'Lamp')

  const state = await db.readListById({ id: list.id, slug: list.slug })
  expect(state.items.map((i) => i.name)).toEqual(['Kettle', 'Lamp'])
})

test('patching an item that is gone reports it rather than throwing', async () => {
  const db = await import('./db.js')
  await db.createList(LIST)
  const list = { id: LIST, slug: LIST }

  // The route turns this false into the 404 that tells a queue to drop the op.
  expect(await db.patchItem(list.id, ITEM, { why: 'because' })).toBe(false)
})

test('removing an item that is already gone reports it rather than throwing', async () => {
  const db = await import('./db.js')
  await db.createList(LIST)
  const list = { id: LIST, slug: LIST }

  await db.addItem(list.id, ITEM, 'Kettle')
  expect(await db.removeItem(list.id, ITEM)).toBe(true)
  // A replayed delete. Idempotent by way of the route's 404, which the syncer
  // treats as done rather than as a failure.
  expect(await db.removeItem(list.id, ITEM)).toBe(false)
})
