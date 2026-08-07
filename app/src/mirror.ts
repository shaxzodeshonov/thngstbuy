/**
 * The list, on the device — a mirror of what the server holds, not the truth.
 *
 * This file used to be `localStore.ts`, and used to be the truth: the app kept
 * its own database and synced with nothing. It is now the local half of a pair.
 * Reads come from here, so the screen paints without waiting for the network and
 * keeps working with the network off. Writes land here first and are queued in
 * `outbox.ts` to be replayed against the server by `sync.ts`.
 *
 * The schema and every statement are transcribed from server/db.js. That is what
 * makes the mirror a mirror: the two halves agree about what a list is, so a
 * snapshot can be dropped in wholesale and a queued write can be replayed
 * upstream without translation.
 *
 * The validation below is kept even though the server validates too. It is not
 * defence against anything hostile — it is what stops the local copy from
 * holding a value the server would later refuse, which would show the user an
 * edit that silently never lands.
 */

import type { Item } from '@domain/types'
import { getAdapter } from './sqlite'
import { slugProblem } from './ids'

export type ListState = {
  slug: string
  version: number
  items: Item[]
}

/**
 * What the HTTP status codes used to say. `missing` is the one the caller acts
 * on — it means the remembered list is gone and a fresh one should be offered.
 */
export type StoreErrorCode = 'missing' | 'taken' | 'invalid' | 'full'

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const LIMITS = { name: 200, model: 500, where: 500, why: 2000, itemsPerList: 500 }
const MAX_PRICE = 1_000_000_000_000

/* ------------------------------------------------------------------ shapes */

type ListRow = { id: string; slug: string | null; version: number }

type ItemRow = {
  id: string
  name: string
  price: number | null
  model: string
  where_to: string
  why: string
  added_at: string
  bought: number
  bought_at: string | null
}

/** Rows come back with SQL column names; the app speaks the Item shape. */
function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    price: row.price === null ? null : Number(row.price),
    model: row.model,
    where: row.where_to,
    why: row.why,
    addedAt: row.added_at,
    bought: Number(row.bought) === 1,
    boughtAt: row.bought_at,
  }
}

async function one<T>(sql: string, args: unknown[]): Promise<T | undefined> {
  const { rows } = await (await getAdapter()).execute(sql, args)
  return rows[0] as T | undefined
}

async function all<T>(sql: string, args: unknown[]): Promise<T[]> {
  const { rows } = await (await getAdapter()).execute(sql, args)
  return rows as T[]
}

async function run(sql: string, args: unknown[]): Promise<number> {
  const { changes } = await (await getAdapter()).execute(sql, args)
  return changes
}

/**
 * Turns whatever the caller is holding — a generated id or a name it was given
 * — into the row it names. Every method starts here, so the rest of the file
 * only ever deals in internal ids.
 */
async function resolve(ref: string): Promise<ListRow> {
  const row = await one<ListRow>(
    `SELECT id, slug, version FROM lists WHERE slug = ? OR id = ? LIMIT 1`,
    [ref, ref],
  )
  if (!row) throw new StoreError('missing', 'That list is not on this device yet.')
  return row
}

async function bumpVersion(listId: string): Promise<void> {
  await run(`UPDATE lists SET version = version + 1, updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    listId,
  ])
}

/** The whole list — what every mutation returns. */
async function readById(listId: string): Promise<ListState> {
  const list = await one<ListRow>(`SELECT id, slug, version FROM lists WHERE id = ?`, [listId])
  if (!list) throw new StoreError('missing', 'That list is not on this device yet.')

  const rows = await all<ItemRow>(
    `SELECT * FROM items WHERE list_id = ? ORDER BY position, rowid`,
    [listId],
  )

  return {
    slug: list.slug ?? list.id,
    version: Number(list.version),
    items: rows.map(toItem),
  }
}

/* ----------------------------------------------------------------- writing */

/** Only the fields the detail screen can edit, mapped to their columns. */
const COLUMNS: Record<string, string> = {
  name: 'name',
  price: 'price',
  model: 'model',
  where: 'where_to',
  why: 'why',
  bought: 'bought',
}

const TEXT_LIMIT: Record<string, number> = {
  name: LIMITS.name,
  model: LIMITS.model,
  where: LIMITS.where,
  why: LIMITS.why,
}

function clean(key: string, value: unknown): string | number | null {
  if (key === 'bought') return value ? 1 : 0

  if (key === 'price') {
    if (value === null || value === undefined || value === '') return null
    const price = Number(value)
    if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
      throw new StoreError('invalid', 'That price does not look right.')
    }
    return Math.round(price)
  }

  const text = String(value ?? '')
  return text.slice(0, TEXT_LIMIT[key] ?? LIMITS.name)
}

/* ------------------------------------------------------------------ mirror */

export const mirror = {
  /**
   * Replaces the local copy of a list with the server's.
   *
   * One transaction, because a half-applied snapshot would be a list that never
   * existed anywhere. Delete-then-insert rather than a diff: the snapshot is
   * authoritative, a list holds at most 500 things, and a diff would still have
   * to reproduce the server's ordering to be correct.
   *
   * `ref` is the name the snapshot was *asked* for, which is not always the name
   * it came back under: someone else may have renamed the list between the
   * request and the response. Matching on both is what stops that from creating
   * a second list and orphaning the rows of the first. It defaults to the
   * snapshot's own slug for the first-contact case, where there is nothing local
   * to match yet.
   */
  async adopt(state: ListState, ref: string = state.slug): Promise<void> {
    const adapter = await getAdapter()
    const now = new Date().toISOString()

    await adapter.transaction(async () => {
      const existing = await one<{ id: string }>(
        `SELECT id FROM lists WHERE slug IN (?, ?) OR id IN (?, ?) LIMIT 1`,
        [state.slug, ref, state.slug, ref],
      )

      const listId = existing?.id ?? state.slug

      if (existing) {
        await run(`UPDATE lists SET slug = ?, version = ?, updated_at = ? WHERE id = ?`, [
          state.slug,
          state.version,
          now,
          listId,
        ])
      } else {
        await run(
          `INSERT INTO lists (id, slug, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
          [listId, state.slug, state.version, now, now],
        )
      }

      await run(`DELETE FROM items WHERE list_id = ?`, [listId])

      let position = 1
      for (const item of state.items) {
        await run(
          `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            listId,
            item.name,
            item.price,
            item.model,
            item.where,
            item.why,
            item.addedAt,
            item.bought ? 1 : 0,
            item.boughtAt,
            position++,
          ],
        )
      }

      await run(
        `INSERT INTO sync_meta (list_id, last_version) VALUES (?, ?)
         ON CONFLICT(list_id) DO UPDATE SET last_version = excluded.last_version`,
        [listId, state.version],
      )
    })
  },

  /**
   * The server version this device last adopted. -1 when it has never synced,
   * which is different from 0 — a brand new list on the server is version 0, and
   * the poll must still fetch it.
   */
  async lastVersion(ref: string): Promise<number> {
    const row = await one<{ last_version: number }>(
      `SELECT last_version FROM sync_meta WHERE list_id = (
         SELECT id FROM lists WHERE slug = ? OR id = ? LIMIT 1)`,
      [ref, ref],
    )
    return row === undefined ? -1 : Number(row.last_version)
  },

  async getList(ref: string): Promise<ListState> {
    return readById((await resolve(ref)).id)
  },

  /** Whether this device has heard of the list at all. */
  async has(ref: string): Promise<boolean> {
    const row = await one<{ id: string }>(
      `SELECT id FROM lists WHERE slug = ? OR id = ? LIMIT 1`,
      [ref, ref],
    )
    return row !== undefined
  },

  async getVersion(ref: string): Promise<{ version: number }> {
    return { version: Number((await resolve(ref)).version) }
  },

  /**
   * Renames the local copy. The server is the one that decides whether a name
   * is free — this only runs once it has agreed, which is why there is no clash
   * check here any more.
   */
  async renameList(ref: string, slug: string): Promise<ListState> {
    const list = await resolve(ref)

    const shape = slugProblem(slug)
    if (shape) throw new StoreError('invalid', shape)

    await run(`UPDATE lists SET slug = ?, updated_at = ? WHERE id = ?`, [
      slug,
      new Date().toISOString(),
      list.id,
    ])
    await bumpVersion(list.id)
    return readById(list.id)
  },

  /**
   * `ON CONFLICT DO NOTHING` for the same reason the server needed it: a queued
   * add is re-applied locally during a rebase, on top of a snapshot that may
   * already contain it.
   */
  async addItem(ref: string, item: { id: string; name: string }): Promise<ListState> {
    const list = await resolve(ref)
    const now = new Date().toISOString()

    const name = String(item.name ?? '').trim()
    if (!name) throw new StoreError('invalid', 'Give it a name first.')

    const counted = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM items WHERE list_id = ?`, [
      list.id,
    ])
    if (Number(counted?.n ?? 0) >= LIMITS.itemsPerList) {
      throw new StoreError('full', `A list holds ${LIMITS.itemsPerList} things.`)
    }

    const next = await one<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM items WHERE list_id = ?`,
      [list.id],
    )

    await run(
      `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
       VALUES (?, ?, ?, NULL, '', '', '', ?, 0, NULL, ?)
       ON CONFLICT(id) DO NOTHING`,
      [item.id, list.id, name.slice(0, LIMITS.name), now, Number(next?.next ?? 1)],
    )

    await bumpVersion(list.id)
    return readById(list.id)
  },

  /**
   * Field-level patch: only the keys present are written. This is the property
   * the whole sync design rests on — replaying these in order against the server
   * merges two people's edits instead of overwriting them.
   */
  async patchItem(ref: string, itemId: string, patch: Partial<Item>): Promise<ListState> {
    const list = await resolve(ref)

    const existing = await one<{ id: string }>(
      `SELECT id FROM items WHERE id = ? AND list_id = ?`,
      [itemId, list.id],
    )
    if (!existing) throw new StoreError('missing', 'That thing is already gone.')

    const sets: string[] = []
    const values: (string | number | null)[] = []

    for (const [key, column] of Object.entries(COLUMNS)) {
      if (!(key in patch)) continue
      sets.push(`${column} = ?`)
      values.push(clean(key, patch[key as keyof Item]))
    }

    // `bought` carries a timestamp with it.
    if ('bought' in patch) {
      sets.push('bought_at = ?')
      values.push(patch.bought ? new Date().toISOString() : null)
    }

    if (sets.length === 0) return readById(list.id)

    await run(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND list_id = ?`, [
      ...values,
      itemId,
      list.id,
    ])
    await bumpVersion(list.id)
    return readById(list.id)
  },

  async removeItem(ref: string, itemId: string): Promise<ListState> {
    const list = await resolve(ref)

    const changes = await run(`DELETE FROM items WHERE id = ? AND list_id = ?`, [itemId, list.id])
    if (changes > 0) await bumpVersion(list.id)
    return readById(list.id)
  },
}
