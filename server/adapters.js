/**
 * One SQL dialect, two places to run it.
 *
 *  - Local development uses `node:sqlite` against a file. No account, no
 *    network, no setup.
 *  - Production uses Turso over HTTP, because Vercel's filesystem is ephemeral
 *    and its function instances don't share one.
 *
 * Both expose the same tiny async surface so `db.js` never knows which it has.
 * Turso *is* SQLite, so the schema and every query are identical.
 */

const TURSO_URL = process.env.TURSO_DATABASE_URL

/** @typedef {{ execute(sql: string, args?: unknown[]): Promise<{rows: any[], rowsAffected: number}>, executeScript(sql: string): Promise<void>, close(): Promise<void> }} Adapter */

/** @returns {Promise<Adapter>} */
async function createTursoAdapter() {
  // The `/web` entry is pure fetch — no native binary, which is what makes it
  // work on a serverless runtime.
  const { createClient } = await import('@libsql/client/web')

  const client = createClient({
    url: TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  return {
    async execute(sql, args = []) {
      const result = await client.execute({ sql, args })
      return { rows: result.rows, rowsAffected: Number(result.rowsAffected ?? 0) }
    },
    executeScript: (sql) => client.executeMultiple(sql),
    async close() {
      client.close()
    },
  }
}

/** @returns {Promise<Adapter>} */
async function createFileAdapter() {
  // Without this the failure is an EROFS deep inside mkdirSync, which tells
  // nobody anything. On Vercel there is no writable disk, so a missing Turso
  // URL can only ever mean the environment variables didn't land.
  if (process.env.VERCEL) {
    throw new Error(
      'TURSO_DATABASE_URL is not set. Vercel has no writable disk, so the local ' +
        'SQLite file cannot be used here. Add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN ' +
        'under Project Settings > Environment Variables, then redeploy.',
    )
  }

  const { DatabaseSync } = await import('node:sqlite')
  const { mkdirSync } = await import('node:fs')
  const { dirname, resolve } = await import('node:path')

  const file = process.env.DB_FILE ?? resolve(process.cwd(), 'data/thngstbuy.db')
  mkdirSync(dirname(file), { recursive: true })

  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    -- WAL already fsyncs at checkpoints; NORMAL is the usual pairing and avoids
    -- an fsync on every single write.
    PRAGMA synchronous = NORMAL;
    -- Wait out a concurrent writer rather than throwing SQLITE_BUSY.
    PRAGMA busy_timeout = 5000;
  `)

  const statements = new Map()
  const prepare = (sql) => {
    let stmt = statements.get(sql)
    if (!stmt) statements.set(sql, (stmt = db.prepare(sql)))
    return stmt
  }

  // Turso answers every statement with a rows array, so anything here that
  // reads must go through `all()` too. PRAGMA belongs in this list: the schema
  // migration asks `table_info` whether a column exists, and an empty answer
  // reads as "missing" and re-runs an ALTER that has already happened.
  const reads = /^\s*(select|pragma|with|explain)/i

  return {
    async execute(sql, args = []) {
      const stmt = prepare(sql)
      if (reads.test(sql)) return { rows: stmt.all(...args), rowsAffected: 0 }
      const result = stmt.run(...args)
      return { rows: [], rowsAffected: Number(result.changes ?? 0) }
    },
    async executeScript(sql) {
      db.exec(sql)
    },
    async close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch {
        // Nothing useful to do while shutting down.
      }
      db.close()
    },
  }
}

export const usingTurso = Boolean(TURSO_URL)

/**
 * Memoised so every serverless invocation on a warm instance reuses the same
 * client instead of opening a new one.
 * @type {Promise<Adapter>}
 */
let adapter
export function getAdapter() {
  adapter ??= usingTurso ? createTursoAdapter() : createFileAdapter()
  return adapter
}
