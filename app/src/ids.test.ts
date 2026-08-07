import { afterEach, expect, test, vi } from 'vitest'
import { createItem } from '@domain/items'

/**
 * Copied verbatim from server/app.js:283. The server keeps a client-supplied
 * item id only if it matches this, and mints its own otherwise — at which point
 * the optimistic row on the phone and the stored row on the server are two
 * different items. Harmless while nothing synced; fatal for a queue that
 * replays adds, because every retry would create another row.
 */
const isUuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value)

// `globalThis.crypto` is getter-only in Node, so it cannot simply be assigned.
const real = globalThis.crypto
afterEach(() => vi.unstubAllGlobals())

test('a new item carries an id the server will accept as its own', () => {
  for (let i = 0; i < 50; i++) {
    expect(isUuid(createItem('Kettle').id)).toBe(true)
  }
})

test('ids are distinct', () => {
  const seen = new Set(Array.from({ length: 500 }, () => createItem('Kettle').id))
  expect(seen.size).toBe(500)
})

test('the getRandomValues fallback is still a shape the server accepts', () => {
  // What Hermes looks like: react-native-get-random-values installs
  // getRandomValues, but there is no randomUUID to go with it.
  vi.stubGlobal('crypto', {
    getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
  })

  for (let i = 0; i < 50; i++) {
    expect(isUuid(createItem('Kettle').id)).toBe(true)
  }
})

test('the last-resort fallback is still a shape the server accepts', () => {
  // No crypto at all. Not cryptographically strong, but the id only has to be
  // unique on one device for long enough to reach the server, and it must have
  // the right shape or the server will replace it.
  vi.stubGlobal('crypto', undefined)

  const ids = Array.from({ length: 200 }, () => createItem('Kettle').id)
  for (const id of ids) expect(isUuid(id)).toBe(true)
  expect(new Set(ids).size).toBe(200)
})
