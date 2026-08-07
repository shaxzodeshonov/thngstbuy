/**
 * Writes that have not reached the server yet, in the order they were made.
 *
 * Order is the whole point. The server applies field-level patches, so replaying
 * these in sequence reproduces what the user did; replaying them out of order
 * would let an older value win. `seq` is an AUTOINCREMENT rather than a plain
 * rowid because draining deletes rows, and a reused number would silently
 * reorder the queue.
 *
 * The ops are deliberately the API's own shapes rather than a private
 * representation — `sync.ts` replays them by handing each one straight to the
 * matching method. There is nothing to translate, so there is nothing to get
 * wrong.
 */

import { getAdapter } from './sqlite'

export type OpKind = 'addItem' | 'patchItem' | 'removeItem'

export type Op = {
  seq: number
  listId: string
  kind: OpKind
  itemId: string | null
  payload: Record<string, unknown>
}

type OpRow = {
  seq: number
  list_id: string
  kind: OpKind
  item_id: string | null
  payload: string
}

const toOp = (row: OpRow): Op => ({
  seq: Number(row.seq),
  listId: row.list_id,
  kind: row.kind,
  itemId: row.item_id,
  payload: JSON.parse(row.payload) as Record<string, unknown>,
})

export const outbox = {
  async append(
    listId: string,
    kind: OpKind,
    itemId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const adapter = await getAdapter()
    await adapter.execute(
      `INSERT INTO outbox (list_id, kind, item_id, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      [listId, kind, itemId, JSON.stringify(payload), new Date().toISOString()],
    )
  },

  /** Everything still queued for one list, oldest first. */
  async peek(listId: string): Promise<Op[]> {
    const adapter = await getAdapter()
    const { rows } = await adapter.execute(
      `SELECT seq, list_id, kind, item_id, payload FROM outbox WHERE list_id = ? ORDER BY seq`,
      [listId],
    )
    return (rows as OpRow[]).map(toOp)
  },

  async drop(seq: number): Promise<void> {
    const adapter = await getAdapter()
    await adapter.execute(`DELETE FROM outbox WHERE seq = ?`, [seq])
  },

  async count(listId: string): Promise<number> {
    const adapter = await getAdapter()
    const { rows } = await adapter.execute(`SELECT COUNT(*) AS n FROM outbox WHERE list_id = ?`, [
      listId,
    ])
    return Number((rows[0] as { n: number }).n)
  },
}
