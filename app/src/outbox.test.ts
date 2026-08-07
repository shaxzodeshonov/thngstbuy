import { beforeEach, expect, test } from 'vitest'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { outbox } from './outbox'

beforeEach(() => useAdapter(() => createNodeAdapter(':memory:')))

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('ops come back in the order they were appended', async () => {
  await outbox.append('l1', 'addItem', A, { id: A, name: 'Kettle' })
  await outbox.append('l1', 'patchItem', A, { price: 200000 })
  await outbox.append('l1', 'removeItem', A, {})

  expect((await outbox.peek('l1')).map((o) => o.kind)).toEqual([
    'addItem',
    'patchItem',
    'removeItem',
  ])
})

test('ops are scoped to their list', async () => {
  await outbox.append('l1', 'addItem', A, { id: A, name: 'Kettle' })
  await outbox.append('l2', 'addItem', B, { id: B, name: 'Lamp' })

  expect(await outbox.count('l1')).toBe(1)
  expect((await outbox.peek('l2')).map((o) => o.itemId)).toEqual([B])
})

test('dropping removes exactly one op', async () => {
  await outbox.append('l1', 'addItem', A, { id: A, name: 'Kettle' })
  await outbox.append('l1', 'addItem', B, { id: B, name: 'Lamp' })

  const [first] = await outbox.peek('l1')
  await outbox.drop(first.seq)

  expect((await outbox.peek('l1')).map((o) => o.itemId)).toEqual([B])
})

test('the payload survives a round trip, nulls included', async () => {
  await outbox.append('l1', 'patchItem', A, { why: 'because', price: null, bought: false })
  expect((await outbox.peek('l1'))[0].payload).toEqual({
    why: 'because',
    price: null,
    bought: false,
  })
})

test('sequence numbers are not reused after a drain', async () => {
  // The queue's ordering guarantee rests on this. If SQLite handed the same
  // number out twice, an op appended after a drain could sort ahead of one
  // still waiting, and an older value would overwrite a newer one.
  await outbox.append('l1', 'addItem', A, { id: A, name: 'Kettle' })
  const [first] = await outbox.peek('l1')
  await outbox.drop(first.seq)

  await outbox.append('l1', 'addItem', B, { id: B, name: 'Lamp' })
  const [second] = await outbox.peek('l1')

  expect(second.seq).toBeGreaterThan(first.seq)
})

test('an empty queue is not an error', async () => {
  expect(await outbox.peek('never-seen')).toEqual([])
  expect(await outbox.count('never-seen')).toBe(0)
})
