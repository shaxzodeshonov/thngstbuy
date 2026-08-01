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

export const newItemId = randomUUID
