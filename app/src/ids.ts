/**
 * Ported from server/ids.js, and now only the reading half of it.
 *
 * Minting a list id belongs to the server: the id is the only access control
 * this app has, because the URL is the credential, and it has to be unguessable
 * to everyone rather than merely unique on one phone.
 *
 * What is left is validation — `slugProblem` in particular, which lets the Name
 * screen reject a name before a request is spent finding out. The rules must
 * stay identical to the server's or the screen will accept names it then
 * refuses, which reads as a bug in the app rather than in the name.
 */

/**
 * Crockford base32 minus the letters that get misread when someone reads an id
 * aloud or retypes it (i, l, o, u). Kept because a generated id is still a name
 * a list can be opened under, and is shown on the rename screen.
 */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const LENGTH = 12


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

/**
 * Turns whatever someone pastes into a list to open, or null.
 *
 * People will paste the whole link, because that is what they were sent. They
 * will also type just the name, because that is what they remember. Both are the
 * same intent, and the difference between them is not the user's problem.
 *
 * Accepts, all case-insensitively and ignoring surrounding space:
 *   https://thngstbuy.vercel.app/l/shaxzod    a shared link
 *   thngstbuy.vercel.app/l/shaxzod            the link without its scheme
 *   thngstbuy://l/shaxzod                     the app's own deep link
 *   shaxzod                                   a chosen name
 *   k3n2p9wxyz01                              a generated id
 */
export function parseListRef(input: unknown): string | null {
  if (typeof input !== 'string') return null

  let text = input.trim().toLowerCase()
  if (!text) return null

  // Anything after /l/ is the name. Everything before it is a host we do not
  // need to check: a link to somebody else's deployment still names a list, and
  // failing on it here would be a worse message than the 404 that follows.
  const path = /\/l\/([^/?#\s]+)/.exec(text)
  if (path) text = path[1]

  // A bare paste can still carry a trailing slash, query or fragment.
  text = text.replace(/[/?#].*$/, '')

  return isListRef(text) ? text : null
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
