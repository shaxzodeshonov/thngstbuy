/**
 * Pure data shapes. No platform APIs — this file is copied verbatim into the
 * React Native app.
 */

export type Item = {
  id: string
  /** What you want to buy. The only required field. */
  name: string
  /** Price in whole UZS. `null` means "not priced yet". */
  price: number | null
  /** Which model / variant / spec. */
  model: string
  /** Where to get it. */
  where: string
  /** Why you want it — the field that talks you out of things. */
  why: string
  /** ISO 8601 timestamp. */
  addedAt: string
  bought: boolean
  /** ISO 8601 timestamp, set when `bought` flips true. */
  boughtAt: string | null
}

/** The subset of fields the detail screen can edit. */
export type ItemDraft = Pick<Item, 'name' | 'price' | 'model' | 'where' | 'why'>
