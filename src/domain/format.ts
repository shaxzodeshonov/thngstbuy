/**
 * Formatting helpers. Pure — no platform APIs, safe to reuse in React Native.
 *
 * The design writes money as thin-spaced groups: `1 085 000`. We do the
 * grouping by hand rather than via Intl so web and native render identically
 * (Hermes ships a trimmed ICU by default).
 */

const NBSP = ' '

/** `1085000` -> `1 085 000`. Negatives keep their sign. */
export function groupDigits(value: number): string {
  const negative = value < 0
  const digits = Math.abs(Math.round(value)).toString()

  let out = ''
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += NBSP
    out += digits[i]
  }
  return negative ? `-${out}` : out
}

/** `1085000` -> `1 085 000 UZS`. */
export function formatMoney(value: number): string {
  return `${groupDigits(value)}${NBSP}UZS`
}

/** Price for the list rows — bare number, no currency, blank when unpriced. */
export function formatPriceShort(price: number | null): string {
  return price === null ? '' : groupDigits(price)
}

/** The two-digit counter in the corner: `5` -> `05`, `12` -> `12`. */
export function formatCount(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** ISO timestamp -> `9 July 2026`. */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Whole days between `iso` and now, floored at 0. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 0
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  return Math.max(0, days)
}

/** `1` -> `1 thing`, `5` -> `5 things`. */
export function pluralise(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/**
 * Reads a price the way a person types it: `450 000`, `450000`, `450k`,
 * `450 000 UZS`. Returns null for anything that isn't a number.
 */
export function parsePrice(input: string): number | null {
  const cleaned = input.trim().toLowerCase()
  if (cleaned === '') return null

  const shorthand = /^([\d\s.,]+)\s*(k|m)?/.exec(cleaned)
  if (!shorthand) return null

  const digits = shorthand[1].replace(/[\s,]/g, '')
  const n = Number(digits)
  if (!Number.isFinite(n)) return null

  const multiplier = shorthand[2] === 'k' ? 1_000 : shorthand[2] === 'm' ? 1_000_000 : 1
  const total = Math.round(n * multiplier)
  return total < 0 ? null : total
}
