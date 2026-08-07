/**
 * Ported from server/ids.js. The shapes are identical so a list created here
 * looks like one the server would have made, but the reasoning behind them has
 * changed: on the server an id is the only access control there is, because the
 * URL is the credential. Nothing leaves this phone, so an id here is just a key
 * in a local table. That is why `newListId` uses `Math.random` and does not
 * reach for a crypto polyfill — there is nobody to guess it from.
 */

/**
 * Crockford base32 minus the letters that get misread when someone reads an id
 * aloud or retypes it (i, l, o, u). Kept because the id is still shown to you
 * on the rename screen.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const LENGTH = 12

export function newListId(): string {
  let id = ''
  for (let i = 0; i < LENGTH; i++) {
    id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return id
}

export function isListId(value: unknown): boolean {
  return typeof value === 'string' && new RegExp(`^[${ALPHABET}]{${LENGTH}}$`).test(value)
}

/** Names a list can be given by hand. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/

/**
 * Held over from the server, where these would collide with a real path. There
 * are no paths here, but a list called `undefined` reads as a bug either way.
 */
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

export function isSlug(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    SLUG.test(value) &&
    !RESERVED.has(value) &&
    // A generated id is a valid slug shape; reserving that space keeps chosen
    // names from ever colliding with one that might be minted later.
    !isListId(value)
  )
}

/** Either shape is a legal thing to open. */
export function isListRef(value: unknown): boolean {
  return isListId(value) || isSlug(value)
}

export function slugProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'Pick a name first.'
  const name = value.trim().toLowerCase()
  if (name.length < 3) return 'Use at least 3 characters.'
  if (name.length > 32) return 'Keep it under 32 characters.'
  if (!/^[a-z0-9-]+$/.test(name)) return 'Letters, numbers and hyphens only.'
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name))
    return 'Start and end with a letter or number.'
  if (RESERVED.has(name)) return 'That name is reserved.'
  if (isListId(name)) return 'That looks like a generated name.'
  return null
}
