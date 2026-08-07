import { beforeEach, expect, test } from 'vitest'
import type { Item } from '@domain/types'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { mirror } from './mirror'

beforeEach(() => useAdapter(() => createNodeAdapter(':memory:')))

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** Everything an Item needs beyond an id and a name. */
const rest = {
  price: null,
  model: '',
  where: '',
  why: '',
  addedAt: '2026-08-07T00:00:00.000Z',
  bought: false,
  boughtAt: null,
} satisfies Omit<Item, 'id' | 'name'>

test('adopting a server snapshot puts it on this device', async () => {
  await mirror.adopt({
    slug: 'shaxzod',
    version: 4,
    items: [{ id: A, name: 'Kettle', ...rest }],
  })

  const state = await mirror.getList('shaxzod')
  expect(state.version).toBe(4)
  expect(state.items.map((i) => i.name)).toEqual(['Kettle'])
})

test('a second adopt drops items the server no longer has', async () => {
  await mirror.adopt({
    slug: 'shaxzod',
    version: 1,
    items: [
      { id: A, name: 'Kettle', ...rest },
      { id: B, name: 'Lamp', ...rest },
    ],
  })
  await mirror.adopt({
    slug: 'shaxzod',
    version: 2,
    items: [{ id: B, name: 'Lamp', ...rest }],
  })

  const state = await mirror.getList('shaxzod')
  expect(state.items.map((i) => i.name)).toEqual(['Lamp'])
})

test('adopt records the version the syncer polls against', async () => {
  expect(await mirror.lastVersion('shaxzod')).toBe(-1)
  await mirror.adopt({ slug: 'shaxzod', version: 7, items: [] })
  expect(await mirror.lastVersion('shaxzod')).toBe(7)
})

test('a rename arriving in a snapshot does not orphan the local row', async () => {
  await mirror.adopt({ slug: 'k3n2p9wxyz01', version: 1, items: [{ id: A, name: 'Kettle', ...rest }] })

  // Someone else renamed the list between the request and the response, so the
  // snapshot comes back under a name this device has never seen.
  await mirror.adopt(
    { slug: 'shaxzod', version: 2, items: [{ id: A, name: 'Kettle', ...rest }] },
    'k3n2p9wxyz01',
  )

  // Both names must reach the same list, because a link handed out under the
  // generated id keeps working after the list is given a nicer name.
  expect((await mirror.getList('shaxzod')).items).toHaveLength(1)
  expect((await mirror.getList('k3n2p9wxyz01')).slug).toBe('shaxzod')
})

test('items keep the order the server gave them', async () => {
  await mirror.adopt({
    slug: 'shaxzod',
    version: 1,
    items: [
      { id: B, name: 'Lamp', ...rest },
      { id: A, name: 'Kettle', ...rest },
    ],
  })

  expect((await mirror.getList('shaxzod')).items.map((i) => i.name)).toEqual(['Lamp', 'Kettle'])
})
