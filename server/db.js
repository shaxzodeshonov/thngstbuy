/**
 * Schema and queries. Everything is async because the production adapter talks
 * to Turso over HTTP; the local file adapter just resolves immediately.
 */

import { getAdapter } from './adapters.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
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
    -- "where" is reserved in SQL; the API still calls it \`where\`.
    where_to TEXT NOT NULL DEFAULT '',
    why      TEXT NOT NULL DEFAULT '',
    added_at TEXT NOT NULL,
    bought   INTEGER NOT NULL DEFAULT 0,
    bought_at TEXT,
    position INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS items_by_list ON items (list_id, position);
`

/**
 * Runs once per process. A serverless instance may be cold, so this can't be a
 * deploy-time step — but `IF NOT EXISTS` makes it free on every warm start.
 * @type {Promise<import('./adapters.js')['getAdapter'] extends never ? never : any>}
 */
let ready
function db() {
  ready ??= (async () => {
    const adapter = await getAdapter()
    await adapter.executeScript(SCHEMA)
    return adapter
  })()
  return ready
}

/**
 * Turso hands integers back as BigInt often enough that every numeric read has
 * to be normalised, or `version` ends up in JSON as a string.
 */
const num = (value) => (value === null || value === undefined ? null : Number(value))

/** Rows come back with SQL column names; the API speaks the client's shape. */
function toItem(row) {
  return {
    id: row.id,
    name: row.name,
    price: num(row.price),
    model: row.model,
    where: row.where_to,
    why: row.why,
    addedAt: row.added_at,
    bought: Number(row.bought) === 1,
    boughtAt: row.bought_at,
  }
}

async function bumpVersion(adapter, listId) {
  await adapter.execute(`UPDATE lists SET version = version + 1, updated_at = ? WHERE id = ?`, [
    new Date().toISOString(),
    listId,
  ])
}

export async function createList(id) {
  const adapter = await db()
  const now = new Date().toISOString()
  await adapter.execute(`INSERT INTO lists (id, version, created_at, updated_at) VALUES (?, 0, ?, ?)`, [
    id,
    now,
    now,
  ])
  return { id, version: 0, items: [] }
}

export async function listExists(id) {
  const adapter = await db()
  const { rows } = await adapter.execute(`SELECT id FROM lists WHERE id = ?`, [id])
  return rows.length > 0
}

/** Just the version — what polling clients ask for every few seconds. */
export async function readVersion(id) {
  const adapter = await db()
  const { rows } = await adapter.execute(`SELECT version FROM lists WHERE id = ?`, [id])
  return rows.length === 0 ? null : num(rows[0].version)
}

/** The whole list — what every mutation returns. */
export async function readList(id) {
  const adapter = await db()
  const { rows } = await adapter.execute(`SELECT id, version FROM lists WHERE id = ?`, [id])
  if (rows.length === 0) return null

  const items = await adapter.execute(
    `SELECT * FROM items WHERE list_id = ? ORDER BY position, rowid`,
    [id],
  )

  return {
    id: rows[0].id,
    version: num(rows[0].version),
    items: items.rows.map(toItem),
  }
}

export async function itemCount(id) {
  const adapter = await db()
  const { rows } = await adapter.execute(`SELECT COUNT(*) AS n FROM items WHERE list_id = ?`, [id])
  return num(rows[0].n)
}

export async function addItem(listId, itemId, name) {
  const adapter = await db()
  const now = new Date().toISOString()

  const { rows } = await adapter.execute(
    `SELECT COALESCE(MAX(position), 0) + 1 AS next FROM items WHERE list_id = ?`,
    [listId],
  )

  await adapter.execute(
    `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
     VALUES (?, ?, ?, NULL, '', '', '', ?, 0, NULL, ?)`,
    [itemId, listId, name, now, num(rows[0].next)],
  )

  await bumpVersion(adapter, listId)
}

/**
 * Field-level patch. Only the keys present in `patch` are written, so two
 * people editing different fields of the same item don't overwrite each other.
 */
const COLUMNS = {
  name: 'name',
  price: 'price',
  model: 'model',
  where: 'where_to',
  why: 'why',
  bought: 'bought',
}

export async function patchItem(listId, itemId, patch) {
  const adapter = await db()

  const existing = await adapter.execute(`SELECT id FROM items WHERE id = ? AND list_id = ?`, [
    itemId,
    listId,
  ])
  if (existing.rows.length === 0) return false

  const sets = []
  const values = []

  for (const [key, column] of Object.entries(COLUMNS)) {
    if (!(key in patch)) continue
    sets.push(`${column} = ?`)
    values.push(key === 'bought' ? (patch.bought ? 1 : 0) : patch[key])
  }

  // `bought` carries a timestamp with it.
  if ('bought' in patch) {
    sets.push('bought_at = ?')
    values.push(patch.bought ? new Date().toISOString() : null)
  }

  if (sets.length === 0) return true

  await adapter.execute(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND list_id = ?`, [
    ...values,
    itemId,
    listId,
  ])
  await bumpVersion(adapter, listId)
  return true
}

export async function removeItem(listId, itemId) {
  const adapter = await db()
  const { rowsAffected } = await adapter.execute(
    `DELETE FROM items WHERE id = ? AND list_id = ?`,
    [itemId, listId],
  )
  if (rowsAffected === 0) return false
  await bumpVersion(adapter, listId)
  return true
}

export async function close() {
  const adapter = await db()
  await adapter.close()
}
