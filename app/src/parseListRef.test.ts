import { expect, test } from 'vitest'
import { parseListRef } from './ids'

const GENERATED = 'tpd3k4q6vb06'

test('a full shared link', () => {
  expect(parseListRef(`https://thngstbuy.vercel.app/l/${GENERATED}`)).toBe(GENERATED)
})

test('a link to a custom name', () => {
  expect(parseListRef('https://thngstbuy.vercel.app/l/shaxzod')).toBe('shaxzod')
})

test('a link without its scheme, as a messaging app often renders it', () => {
  expect(parseListRef('thngstbuy.vercel.app/l/shaxzod')).toBe('shaxzod')
})

test("the app's own deep link", () => {
  expect(parseListRef('thngstbuy://l/shaxzod')).toBe('shaxzod')
})

test('a bare generated id', () => {
  expect(parseListRef(GENERATED)).toBe(GENERATED)
})

test('a bare custom name', () => {
  expect(parseListRef('shaxzod')).toBe('shaxzod')
})

test('surrounding whitespace, which a paste almost always carries', () => {
  expect(parseListRef('  shaxzod\n')).toBe('shaxzod')
  expect(parseListRef(` https://thngstbuy.vercel.app/l/${GENERATED} `)).toBe(GENERATED)
})

test('the capitals a phone keyboard adds unasked', () => {
  expect(parseListRef('Shaxzod')).toBe('shaxzod')
  expect(parseListRef('HTTPS://THNGSTBUY.VERCEL.APP/L/SHAXZOD')).toBe('shaxzod')
})

test('a trailing slash, query or fragment', () => {
  expect(parseListRef('https://thngstbuy.vercel.app/l/shaxzod/')).toBe('shaxzod')
  expect(parseListRef('https://thngstbuy.vercel.app/l/shaxzod?utm_source=x')).toBe('shaxzod')
  expect(parseListRef('shaxzod#top')).toBe('shaxzod')
})

test('a link from somewhere else that still names a list', () => {
  // Not our host, but the intent is unambiguous. Letting the 404 explain it is
  // a better message than refusing to read a perfectly clear link.
  expect(parseListRef('https://example.com/l/shaxzod')).toBe('shaxzod')
})

test('nonsense is rejected rather than guessed at', () => {
  expect(parseListRef('')).toBeNull()
  expect(parseListRef('   ')).toBeNull()
  expect(parseListRef('a')).toBeNull()
  expect(parseListRef('has spaces')).toBeNull()
  expect(parseListRef('under_scores')).toBeNull()
  expect(parseListRef('https://thngstbuy.vercel.app/')).toBeNull()
  expect(parseListRef(null)).toBeNull()
  expect(parseListRef(42)).toBeNull()
})

test('reserved words are rejected, matching the server', () => {
  expect(parseListRef('api')).toBeNull()
  expect(parseListRef('admin')).toBeNull()
  expect(parseListRef('undefined')).toBeNull()
})
