/**
 * The list, on the device. This replaces the REST client the app used to talk
 * to: there is no server, no network call and no account, so everything the API
 * did happens here against a SQLite file inside the app's own storage.
 *
 * The method names, arguments and return shapes are deliberately the ones
 * `api.ts` had, because `useSyncedList` was written against them and the
 * optimistic-update rules it implements are worth keeping — a write still
 * returns the whole new state, so a caller never needs a follow-up read.
 *
 * The schema and every statement are transcribed from server/db.js. Keeping
 * them identical means the two halves of the project still agree about what a
 * list is, even though nothing syncs between them any more.
 */

import * as SQLite from 'expo-sqlite'
import type { Item } from '@domain/types'
import { newListId, slugProblem } from './ids'

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

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
    slug       TEXT,
    version    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id       TEXT PRIMARY KEY,
    list_id  TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    price    INTEGER,
    model    TEXT NOT NULL DEFAULT '',
    -- "where" is reserved in SQL; the Item shape still calls it \`where\`.
    where_to TEXT NOT NULL DEFAULT '',
    why      TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL,
    bought   INTEGER NOT NULL DEFAULT 0,
    bought_at TEXT,
    position INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS items_by_list ON items (list_id, position);
  CREATE UNIQUE INDEX IF NOT EXISTS lists_by_slug ON lists (slug);
`

/**
 * Opened once and shared. The server had to redo this per cold start; here the
 * process outlives every call, so the promise is simply memoised.
 *
 * The schema runs on open rather than at install time because there is no
 * install step to hang it off — `IF NOT EXISTS` makes it free on every launch.
 */
let opening: Promise<SQLite.SQLiteDatabase> | undefined
function db(): Promise<SQLite.SQLiteDatabase> {
  opening ??= (async () => {
    const handle = await SQLite.openDatabaseAsync('thngstbuy.db')
    await handle.execAsync(SCHEMA)
    return handle
  })()
  return opening
}

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

/**
 * Turns whatever the caller is holding — a generated id or a name it was given
 * — into the row it names. Every method starts here, so the rest of the file
 * only ever deals in internal ids.
 */
async function resolve(ref: string): Promise<ListRow> {
  const handle = await db()
  const row = await handle.getFirstAsync<ListRow>(
    `SELECT id, slug, version FROM lists WHERE slug = ? OR id = ? LIMIT 1`,
    ref,
    ref,
  )
  if (!row) throw new StoreError('missing', 'That list no longer exists on this device.')
  return row
}

async function bumpVersion(listId: string): Promise<void> {
  const handle = await db()
  await handle.runAsync(
    `UPDATE lists SET version = version + 1, updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    listId,
  )
}

/** The whole list — what every mutation returns. */
async function readById(listId: string): Promise<ListState> {
  const handle = await db()

  const list = await handle.getFirstAsync<ListRow>(
    `SELECT id, slug, version FROM lists WHERE id = ?`,
    listId,
  )
  if (!list) throw new StoreError('missing', 'That list no longer exists on this device.')

  const rows = await handle.getAllAsync<ItemRow>(
    `SELECT * FROM items WHERE list_id = ? ORDER BY position, rowid`,
    listId,
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

/**
 * The checks the server's routes used to do. They are worth keeping even with
 * nobody hostile on the other end: they are what stops a stray paste from
 * putting a megabyte of text in a row, and they keep the columns the same shape
 * the web app would have written.
 */
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

/* ------------------------------------------------------------------- store */

export const store = {
  /** Start a new list. Retries only on the astronomically unlikely id clash. */
  async createList(): Promise<ListState> {
    const handle = await db()
    const now = new Date().toISOString()

    for (let attempt = 0; attempt < 5; attempt++) {
      const id = newListId()
      try {
        await handle.runAsync(
          `INSERT INTO lists (id, slug, version, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
          id,
          id,
          now,
          now,
        )
        return { slug: id, version: 0, items: [] }
      } catch {
        // Unique constraint on id or slug — draw another one.
      }
    }

    throw new StoreError('invalid', 'Could not start a new list.')
  },

  async getList(ref: string): Promise<ListState> {
    return readById((await resolve(ref)).id)
  },

  /** Just the version. Cheap enough that the caller can ask whenever it likes. */
  async getVersion(ref: string): Promise<{ version: number }> {
    return { version: Number((await resolve(ref)).version) }
  },

  /**
   * Renames the list. A clash is an ordinary thing to hit rather than a fault,
   * so it comes back as a `taken` error the screen can phrase for itself.
   */
  async renameList(ref: string, slug: string): Promise<ListState> {
    const list = await resolve(ref)
    const handle = await db()

    // The server used to enforce the shape before the query ever ran. With the
    // routes gone this is the last place that can, so it happens here rather
    // than in the screen that happens to be asking.
    const shape = slugProblem(slug)
    if (shape) throw new StoreError('invalid', shape)

    const clash = await handle.getFirstAsync<{ id: string }>(
      `SELECT id FROM lists WHERE slug = ? AND id != ?`,
      slug,
      list.id,
    )
    if (clash) throw new StoreError('taken', 'You already have a list with that name.')

    await handle.runAsync(
      `UPDATE lists SET slug = ?, updated_at = ? WHERE id = ?`,
      slug,
      new Date().toISOString(),
      list.id,
    )
    await bumpVersion(list.id)
    return readById(list.id)
  },

  async addItem(ref: string, item: { id: string; name: string }): Promise<ListState> {
    const list = await resolve(ref)
    const handle = await db()
    const now = new Date().toISOString()

    const name = String(item.name ?? '').trim()
    if (!name) throw new StoreError('invalid', 'Give it a name first.')

    const counted = await handle.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM items WHERE list_id = ?`,
      list.id,
    )
    if (Number(counted?.n ?? 0) >= LIMITS.itemsPerList) {
      throw new StoreError('full', `A list holds ${LIMITS.itemsPerList} things.`)
    }

    const next = await handle.getFirstAsync<{ next: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM items WHERE list_id = ?`,
      list.id,
    )

    await handle.runAsync(
      `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
       VALUES (?, ?, ?, NULL, '', '', '', ?, 0, NULL, ?)`,
      item.id,
      list.id,
      name.slice(0, LIMITS.name),
      now,
      Number(next?.next ?? 1),
    )

    await bumpVersion(list.id)
    return readById(list.id)
  },

  /**
   * Field-level patch: only the keys present are written. On the server this
   * kept two people editing different fields from overwriting each other. Here
   * it does something smaller but still real — a debounced `why` landing late
   * cannot revive the `name` it was holding when the buffer opened.
   */
  async patchItem(ref: string, itemId: string, patch: Partial<Item>): Promise<ListState> {
    const list = await resolve(ref)
    const handle = await db()

    const existing = await handle.getFirstAsync<{ id: string }>(
      `SELECT id FROM items WHERE id = ? AND list_id = ?`,
      itemId,
      list.id,
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

    await handle.runAsync(
      `UPDATE items SET ${sets.join(', ')} WHERE id = ? AND list_id = ?`,
      ...values,
      itemId,
      list.id,
    )
    await bumpVersion(list.id)
    return readById(list.id)
  },

  async removeItem(ref: string, itemId: string): Promise<ListState> {
    const list = await resolve(ref)
    const handle = await db()

    const result = await handle.runAsync(
      `DELETE FROM items WHERE id = ? AND list_id = ?`,
      itemId,
      list.id,
    )
    if (result.changes > 0) await bumpVersion(list.id)
    return readById(list.id)
  },
}
