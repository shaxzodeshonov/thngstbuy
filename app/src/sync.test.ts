import { beforeEach, expect, test, vi } from 'vitest'
import type { Item } from '@domain/types'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { mirror } from './mirror'
import { outbox } from './outbox'
import { createSyncer } from './sync'
import { ApiError, type ListState } from './api'

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const LIST = 'shaxzod'

const rest = {
  price: null,
  model: '',
  where: '',
  why: '',
  addedAt: '2026-08-07T00:00:00.000Z',
  bought: false,
  boughtAt: null,
} satisfies Omit<Item, 'id' | 'name'>

/**
 * A stand-in server. It holds real state and applies the same field-level patch
 * semantics the real one does, because the merge behaviour under test is a
 * property of those semantics rather than of the transport.
 */
function fakeApi(initial: ListState) {
  let state = initial
  const calls: string[] = []

  return {
    calls,
    current: () => state,
    /** Simulates someone else editing the list. */
    poke: (next: ListState) => {
      state = next
    },

    getVersion: vi.fn(async () => ({ version: state.version })),
    getList: vi.fn(async () => state),

    addItem: vi.fn(async (_ref: string, item: { id: string; name: string }) => {
      calls.push(`add:${item.id}`)
      if (!state.items.some((i) => i.id === item.id)) {
        state = {
          ...state,
          version: state.version + 1,
          items: [...state.items, { id: item.id, name: item.name, ...rest }],
        }
      }
      return state
    }),

    patchItem: vi.fn(async (_ref: string, itemId: string, patch: Partial<Item>) => {
      calls.push(`patch:${itemId}`)
      if (!state.items.some((i) => i.id === itemId)) throw new ApiError(404, 'no such item')
      state = {
        ...state,
        version: state.version + 1,
        items: state.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
      }
      return state
    }),

    removeItem: vi.fn(async (_ref: string, itemId: string) => {
      calls.push(`remove:${itemId}`)
      if (!state.items.some((i) => i.id === itemId)) throw new ApiError(404, 'no such item')
      state = {
        ...state,
        version: state.version + 1,
        items: state.items.filter((i) => i.id !== itemId),
      }
      return state
    }),

    createList: vi.fn(),
    renameList: vi.fn(),
  }
}

const offline = () => {
  throw new TypeError('Network request failed')
}

beforeEach(async () => {
  useAdapter(() => createNodeAdapter(':memory:'))
  await mirror.adopt({ slug: LIST, version: 0, items: [] })
})

test('a queued write reaches the server and leaves the outbox', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${A}`])
  expect(await outbox.count(LIST)).toBe(0)
  expect(syncer.state()).toMatchObject({ live: true, pending: 0 })
})

test('ops replay in the order they were made', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.enqueue('patchItem', A, { price: 200000 })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${A}`, `patch:${A}`, `add:${B}`])
})

test('a 404 on patch drops the op — delete beats edit', async () => {
  // The server never heard of this item: someone else deleted it.
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('patchItem', A, { why: 'because' })
  await syncer.cycle()

  expect(await outbox.count(LIST)).toBe(0)
  expect(syncer.state().live).toBe(true)
})

test('a replayed delete of something already gone counts as done', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('removeItem', A, {})
  await syncer.cycle()

  expect(await outbox.count(LIST)).toBe(0)
})

test('a network failure keeps the op and reports not-live', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  server.addItem = vi.fn(offline) as never
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()

  expect(await outbox.count(LIST)).toBe(1)
  expect(syncer.state()).toMatchObject({ live: false, pending: 1 })
})

test('draining stops at the first transient failure, so order holds', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  server.addItem = vi.fn(offline) as never
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.enqueue('patchItem', A, { price: 1 })
  await syncer.cycle()

  // Sending the patch anyway would apply an edit to an item the server does not
  // have yet, and the add behind it would then reinstate the original name.
  expect(server.patchItem).not.toHaveBeenCalled()
  expect(await outbox.count(LIST)).toBe(2)
})

test('a refused value drops rather than blocking the queue behind it', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const real = server.addItem
  server.addItem = vi.fn(async (ref: string, item: { id: string; name: string }) => {
    if (item.id === A) throw new ApiError(400, 'name is required')
    return real(ref, item)
  }) as never
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: '' })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${B}`])
  expect(await outbox.count(LIST)).toBe(0)
})

test('a successful drain leaves the mirror agreeing with the server', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()

  const local = await mirror.getList(LIST)
  expect(local.items.map((i) => i.name)).toEqual(['Kettle'])
  expect(local.version).toBe(server.current().version)
})

test('someone else’s change is pulled in', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  server.poke({ slug: LIST, version: 9, items: [{ id: B, name: 'Lamp', ...rest }] })
  await syncer.cycle()

  expect((await mirror.getList(LIST)).items.map((i) => i.name)).toEqual(['Lamp'])
})

test('an unchanged version does not refetch the list', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const syncer = createSyncer(LIST, { api: server as never })

  await syncer.cycle()
  const after = server.getList.mock.calls.length
  await syncer.cycle()

  expect(server.getList.mock.calls.length).toBe(after)
})

test('a pulled snapshot does not erase an unsent edit', async () => {
  // The server knows about Kettle. Offline, we rename it and add Lamp.
  const server = fakeApi({
    slug: LIST,
    version: 5,
    items: [{ id: A, name: 'Kettle', ...rest }],
  })
  await mirror.adopt(server.current())

  server.addItem = vi.fn(offline) as never
  server.patchItem = vi.fn(offline) as never

  const syncer = createSyncer(LIST, { api: server as never })
  await syncer.enqueue('patchItem', A, { name: 'Electric kettle' })
  await mirror.patchItem(LIST, A, { name: 'Electric kettle' })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await mirror.addItem(LIST, { id: B, name: 'Lamp' })

  await syncer.cycle()

  // Both edits are still on screen, even though neither reached the server.
  const local = await mirror.getList(LIST)
  expect(local.items.map((i) => i.name)).toEqual(['Electric kettle', 'Lamp'])
})

test('a half-drained queue leaves the unsent edits on screen', async () => {
  // The case rebase actually exists for. Adopting the response to op 1 replaces
  // the mirror with a server snapshot that knows nothing about ops 2 and 3 --
  // so if op 2 then fails, the user watches their own work disappear.
  const server = fakeApi({ slug: LIST, version: 5, items: [{ id: A, name: 'Kettle', ...rest }] })
  await mirror.adopt(server.current())

  const syncer = createSyncer(LIST, { api: server as never })

  // Op 1 will succeed.
  await syncer.enqueue('patchItem', A, { price: 200000 })
  await mirror.patchItem(LIST, A, { price: 200000 })

  // Op 2 will not.
  server.addItem = vi.fn(offline) as never
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await mirror.addItem(LIST, { id: B, name: 'Lamp' })

  await syncer.cycle()

  const local = await mirror.getList(LIST)
  expect(local.items.map((i) => i.name)).toEqual(['Kettle', 'Lamp'])
  expect(local.items[0].price).toBe(200000)
  expect(syncer.state()).toMatchObject({ live: false, pending: 1 })
})

test('coming back online sends everything that piled up', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const failing = vi.fn(offline)
  const working = server.addItem
  server.addItem = failing as never

  const syncer = createSyncer(LIST, { api: server as never })
  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()
  expect(syncer.state().pending).toBe(2)

  server.addItem = working
  await syncer.cycle()

  expect(syncer.state()).toMatchObject({ live: true, pending: 0 })
  expect(server.current().items.map((i) => i.name)).toEqual(['Kettle', 'Lamp'])
})

test('watchers hear about the connection going away and coming back', async () => {
  const server = fakeApi({ slug: LIST, version: 0, items: [] })
  const working = server.addItem
  server.addItem = vi.fn(offline) as never

  const syncer = createSyncer(LIST, { api: server as never })
  const seen: boolean[] = []
  syncer.subscribe((s) => seen.push(s.live))

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()
  server.addItem = working
  await syncer.cycle()

  expect(seen).toContain(false)
  expect(seen.at(-1)).toBe(true)
})
