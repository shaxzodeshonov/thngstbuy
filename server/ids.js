import { randomBytes, randomUUID } from 'node:crypto'

/**
 * List ids are the only access control this app has — the URL is the
 * credential. 12 characters from a 32-symbol alphabet is 60 bits, which is not
 * guessable at any practical rate.
 *
 * Crockford base32 minus the letters that get misread when someone reads a link
 * aloud or retypes it (i, l, o, u).
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const LENGTH = 12

export function newListId() {
  const bytes = randomBytes(LENGTH)
  let id = ''
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[bytes[i] % ALPHABET.length]
  return id
}

export function isListId(value) {
  return typeof value === 'string' && new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(value)
}

/**
 * Names a list can be given by hand, e.g. /l/shaxzod.
 *
 * A custom name trades away the only protection this app has: the generated id
 * is unguessable, a chosen word is not. Anyone who types the name reaches the
 * list and can edit it. That is the user's call to make, so the rules here only
 * enforce what would otherwise break routing or confuse a reader.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

/** Words that would collide with a real path or read as something official. */
const RESERVED = new Set([
  'api',
  'l',
  'new',
  'list',
  'lists',
  'admin',
  'healthz',
  'index',
  'assets',
  'static',
  'robots',
  'favicon',
  'null',
  'undefined',
  'settings',
  'about',
  'help',
])

export function isSlug(value) {
  return (
    typeof value === 'string' &&
    SLUG.test(value) &&
    !RESERVED.has(value) &&
    // A generated id is a valid slug shape; reserving that space keeps chosen
    // names from ever colliding with one the server might mint later.
    !isListId(value)
  )
}

/** Either shape is a legal thing to find in /l/<here>. */
export function isListRef(value) {
  return isListId(value) || isSlug(value)
}

export function slugProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'Pick a name first.'
  const name = value.trim().toLowerCase()
  if (name.length < 3) return 'Use at least 3 characters.'
  if (name.length > 32) return 'Keep it under 32 characters.'
  if (!/^[a-z0-9-]+$/.test(name)) return 'Letters, numbers and hyphens only.'
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name))
    return 'Start and end with a letter or number.'
  if (RESERVED.has(name)) return 'That name is reserved.'
  if (isListId(name)) return 'That looks like a generated link.'
  return null
}

export const newItemId = randomUUID
