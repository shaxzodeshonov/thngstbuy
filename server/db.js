/**
 * Schema and queries. Everything is async because the production adapter talks
 * to Turso over HTTP; the local file adapter just resolves immediately.
 *
 * A list has two identifiers. `id` is generated once and never changes, so item
 * rows can point at it forever. `slug` is what appears in the URL and can be
 * renamed. Keeping them apart means renaming a list rewrites one column instead
 * of cascading through every item.
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
 */
let ready
function db() {
  ready ??= (async () => {
    const adapter = await getAdapter()
    await adapter.executeScript(SCHEMA)
    await addSlugColumn(adapter)
    return adapter
  })()
  return ready
}

/**
 * `slug` arrived after the first lists already existed, and SQLite has no
 * "ADD COLUMN IF NOT EXISTS". Existing lists keep their generated id as their
 * slug, so every link that was already shared keeps working.
 */
async function addSlugColumn(adapter) {
  const { rows } = await adapter.execute(`PRAGMA table_info(lists)`)
  if (rows.some((row) => row.name === 'slug')) return

  await adapter.execute(`ALTER TABLE lists ADD COLUMN slug TEXT`)
  await adapter.execute(`UPDATE lists SET slug = id WHERE slug IS NULL`)
  await adapter.execute(`CREATE UNIQUE INDEX IF NOT EXISTS lists_by_slug ON lists (slug)`)
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

/**
 * Turns whatever was in the URL into the row it names. Every route starts here,
 * so the rest of the file only ever deals in internal ids.
 */
export async function resolveList(ref) {
  const adapter = await db()
  const { rows } = await adapter.execute(
    `SELECT id, slug, version FROM lists WHERE slug = ? OR id = ? LIMIT 1`,
    [ref, ref],
  )
  if (rows.length === 0) return null
  return { id: rows[0].id, slug: rows[0].slug ?? rows[0].id, version: num(rows[0].version) }
}

export async function createList(id) {
  const adapter = await db()
  const now = new Date().toISOString()
  await adapter.execute(
    `INSERT INTO lists (id, slug, version, created_at, updated_at) VALUES (?, ?, 0, ?, ?)`,
    [id, id, now, now],
  )
  return { slug: id, version: 0, items: [] }
}

/** Just the version — what polling clients ask for every few seconds. */
export async function readVersion(ref) {
  const list = await resolveList(ref)
  return list === null ? null : list.version
}

/** The whole list — what every mutation returns. */
export async function readList(ref) {
  const list = await resolveList(ref)
  if (!list) return null
  return readListById(list)
}

async function readListById(list) {
  const adapter = await db()
  const items = await adapter.execute(
    `SELECT * FROM items WHERE list_id = ? ORDER BY position, rowid`,
    [list.id],
  )
  const { rows } = await adapter.execute(`SELECT slug, version FROM lists WHERE id = ?`, [list.id])
  return {
    slug: rows[0]?.slug ?? list.slug,
    version: num(rows[0]?.version ?? list.version),
    items: items.rows.map(toItem),
  }
}

export { readListById }

/**
 * Renames the list. Returns 'taken' rather than throwing so the route can say
 * something useful — a clash is an ordinary thing for a person to hit, not an
 * error.
 */
export async function renameList(listId, slug) {
  const adapter = await db()

  const { rows } = await adapter.execute(`SELECT id FROM lists WHERE slug = ? AND id != ?`, [
    slug,
    listId,
  ])
  if (rows.length > 0) return 'taken'

  await adapter.execute(`UPDATE lists SET slug = ?, updated_at = ? WHERE id = ?`, [
    slug,
    new Date().toISOString(),
    listId,
  ])
  await bumpVersion(adapter, listId)
  return 'ok'
}

export async function itemCount(listId) {
  const adapter = await db()
  const { rows } = await adapter.execute(`SELECT COUNT(*) AS n FROM items WHERE list_id = ?`, [
    listId,
  ])
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
     VALUES (?, ?, ?, NULL, '', '', '', ?, 0, NULL, ?)
     -- The client generates the id, so a collision means "this add already
     -- landed", not "two things clashed". The phone queues writes while offline
     -- and replays them, and a retry after a lost response would otherwise fail
     -- the constraint, return 500, and wedge that list's queue for good.
     --
     -- DO NOTHING rather than an upsert: the retry carries the original name,
     -- which must not overwrite an edit made in between.
     ON CONFLICT(id) DO NOTHING`,
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
