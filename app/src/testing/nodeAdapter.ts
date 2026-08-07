/**
 * The test backend. Imported by tests only — no app module references this
 * file, so Metro never follows `node:sqlite` into the bundle.
 *
 * Modelled on `createFileAdapter` in server/adapters.js, for the same reason it
 * exists there: SQLite is SQLite, so the same statements run unchanged.
 */

import { DatabaseSync } from 'node:sqlite'
import type { Adapter } from '../sqlite'

const reads = /^\s*(select|pragma|with|explain)/i

export async function createNodeAdapter(file = ':memory:'): Promise<Adapter> {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON;')

  return {
    async execute(sql, args = []) {
      const stmt = db.prepare(sql)
      if (reads.test(sql)) return { rows: stmt.all(...(args as any[])) as any[], changes: 0 }
      const result = stmt.run(...(args as any[]))
      return { rows: [], changes: Number(result.changes ?? 0) }
    },

    async executeScript(sql) {
      db.exec(sql)
    },

    /**
     * `node:sqlite` is synchronous, but the work handed in is not — awaiting it
     * inside BEGIN/COMMIT is exactly what expo-sqlite's withTransactionAsync
     * does, so both backends have the same semantics.
     */
    async transaction(run) {
      db.exec('BEGIN')
      try {
        const value = await run()
        db.exec('COMMIT')
        return value
      } catch (failure) {
        db.exec('ROLLBACK')
        throw failure
      }
    },

    async close() {
      db.close()
    },
  }
}
