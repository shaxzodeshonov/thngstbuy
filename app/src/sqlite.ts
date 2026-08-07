/**
 * One SQL dialect, two places to run it — the same split `server/adapters.js`
 * makes for the website.
 *
 *  - On the phone it is `expo-sqlite`, a native module.
 *  - Under vitest it is `node:sqlite`, so the statements the tests exercise are
 *    the statements the app really runs. Without this seam the storage layer
 *    would only ever be testable on a device, which in practice means untested.
 *
 * The Node implementation deliberately lives elsewhere (`testing/nodeAdapter`)
 * and is imported by no app module, so Metro never tries to bundle `node:sqlite`
 * into the APK.
 */

import * as SQLite from 'expo-sqlite'

export type Row = Record<string, any>

export type Adapter = {
  execute(sql: string, args?: unknown[]): Promise<{ rows: Row[]; changes: number }>
  executeScript(sql: string): Promise<void>
  transaction<T>(run: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

/**
 * Which statements return rows. Both backends need telling, because one answers
 * reads and writes through different methods.
 */
const reads = /^\s*(select|pragma|with|explain)/i

async function createExpoAdapter(): Promise<Adapter> {
  const handle = await SQLite.openDatabaseAsync('thngstbuy.db')

  return {
    async execute(sql, args = []) {
      if (reads.test(sql)) {
        return { rows: await handle.getAllAsync<Row>(sql, ...(args as any[])), changes: 0 }
      }
      const result = await handle.runAsync(sql, ...(args as any[]))
      return { rows: [], changes: result.changes }
    },
    executeScript: (sql) => handle.execAsync(sql),

    // withTransactionAsync resolves to void, so the value has to be carried out
    // by hand rather than returned through it.
    async transaction<T>(run: () => Promise<T>): Promise<T> {
      let result!: T
      await handle.withTransactionAsync(async () => {
        result = await run()
      })
      return result
    },

    close: () => handle.closeAsync(),
  }
}

/**
 * The schema, applied on open. `IF NOT EXISTS` throughout makes that free on
 * every launch, and there is no install step to hang a migration off.
 *
 * `lists` and `items` are transcribed from `server/db.js` and are a mirror of
 * what the server holds. `outbox` and `sync_meta` are this device's own and have
 * no counterpart there — they are the record of what has not been sent yet.
 */
export const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
    slug       TEXT,
    version    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id        TEXT PRIMARY KEY,
    list_id   TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    price     INTEGER,
    model     TEXT NOT NULL DEFAULT '',
    -- "where" is reserved in SQL; the Item shape still calls it \`where\`.
    where_to  TEXT NOT NULL DEFAULT '',
    why       TEXT NOT NULL DEFAULT '',
    added_at  TEXT NOT NULL,
    bought    INTEGER NOT NULL DEFAULT 0,
    bought_at TEXT,
    position  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS items_by_list ON items (list_id, position);
  CREATE UNIQUE INDEX IF NOT EXISTS lists_by_slug ON lists (slug);

  -- Writes that have not reached the server yet. AUTOINCREMENT rather than
  -- rowid reuse: draining deletes rows, and a reused seq would reorder the
  -- queue, which is the one thing it must never do.
  CREATE TABLE IF NOT EXISTS outbox (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    item_id    TEXT,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS outbox_by_list ON outbox (list_id, seq);

  CREATE TABLE IF NOT EXISTS sync_meta (
    list_id      TEXT PRIMARY KEY,
    last_version INTEGER NOT NULL
  );
`

let override: (() => Promise<Adapter>) | null = null
let opening: Promise<Adapter> | undefined

/**
 * Swaps the backend, for tests. Passing null restores the real one. Resetting
 * the memoised promise is the point — each test wants its own empty database.
 */
export function useAdapter(factory: (() => Promise<Adapter>) | null): void {
  override = factory
  opening = undefined
}

export function getAdapter(): Promise<Adapter> {
  opening ??= (async () => {
    const adapter = await (override ?? createExpoAdapter)()
    await adapter.executeScript(SCHEMA)
    return adapter
  })()
  return opening
}
