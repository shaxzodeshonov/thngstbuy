/**
 * Getting what happened on this phone onto the server, and what happened
 * elsewhere onto this phone.
 *
 * The design rests on one property of the API: writes are field-level patches
 * against client-generated ids. That makes replaying the outbox in order the
 * same thing as merging — two people editing different fields of one item both
 * survive, and the loser of a same-field race is simply whoever arrived first.
 * There is no version vector here because none is needed.
 *
 * What is needed is care in two places:
 *
 *  1. **Draining stops at the first transient failure.** Skipping a stuck op to
 *     send the next one would let an older value overwrite a newer one — or
 *     apply a patch to an item whose `add` has not landed yet.
 *  2. **A snapshot pulled while ops are still queued is rebased, not adopted.**
 *     The snapshot goes into the mirror and the pending ops are re-applied on
 *     top. Without this an unsent edit visibly reverts and then returns, which
 *     reads as data loss even though nothing was lost.
 *
 * `cycle()` runs to completion rather than scheduling itself. The retry cadence
 * belongs to the screen that knows whether anyone is looking — see the poll loop
 * in useSyncedList — and keeping the timer out of here is what lets every rule
 * above be tested without faking one.
 */

import { ApiError, api as realApi, type ListState } from './api'
import { mirror } from './mirror'
import { type Op, type OpKind, outbox } from './outbox'

export type SyncState = {
  /** False when the last attempt to reach the server failed. */
  live: boolean
  /** Writes made on this device that the server has not acknowledged. */
  pending: number
}

/** What the poll loop waits after a failure, in order, then repeats the last. */
export const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000] as const

type Deps = { api: typeof realApi }

export function createSyncer(listId: string, deps: Partial<Deps> = {}) {
  const api = deps.api ?? realApi

  let state: SyncState = { live: true, pending: 0 }
  const watchers = new Set<(state: SyncState) => void>()
  const listeners = new Set<() => void>()

  function publish(next: Partial<SyncState>) {
    state = { ...state, ...next }
    for (const watcher of watchers) watcher(state)
  }

  /** Hands one op to the method it names. */
  function send(op: Op): Promise<ListState> {
    switch (op.kind) {
      case 'addItem':
        return api.addItem(listId, op.payload as { id: string; name: string })
      case 'patchItem':
        return api.patchItem(listId, op.itemId!, op.payload)
      case 'removeItem':
        return api.removeItem(listId, op.itemId!)
    }
  }

  /**
   * Whether an op can ever succeed. A 404 means the item is gone upstream, so a
   * pending edit to it is moot and a pending delete of it has already happened.
   * A 400 or 409 means the server refuses the value itself — retrying can only
   * fail the same way for ever, and leaving it at the head of the queue would
   * block every write behind it.
   */
  const isFinal = (failure: unknown) =>
    failure instanceof ApiError && [400, 404, 409].includes(failure.status)

  /** Replays queued ops until they run out or one cannot get through. */
  async function drain(): Promise<boolean> {
    for (const op of await outbox.peek(listId)) {
      try {
        await mirror.adopt(await send(op), listId)
      } catch (failure) {
        if (!isFinal(failure)) {
          publish({ live: false, pending: await outbox.count(listId) })
          return false
        }
      }
      await outbox.drop(op.seq)
    }

    publish({ live: true, pending: 0 })
    return true
  }

  /** Fetches the list, but only when the server says it has moved. */
  async function pull(): Promise<void> {
    const { version } = await api.getVersion(listId)
    if (version === (await mirror.lastVersion(listId))) return
    await mirror.adopt(await api.getList(listId), listId)
  }

  /**
   * Re-applies queued ops on top of whatever the mirror now holds, so the screen
   * keeps showing work that has not been sent.
   */
  async function rebase(pending: Op[]): Promise<void> {
    for (const op of pending) {
      try {
        switch (op.kind) {
          case 'addItem':
            await mirror.addItem(listId, op.payload as { id: string; name: string })
            break
          case 'patchItem':
            await mirror.patchItem(listId, op.itemId!, op.payload)
            break
          case 'removeItem':
            await mirror.removeItem(listId, op.itemId!)
            break
        }
      } catch {
        // The op no longer applies to this snapshot — a patch for something the
        // server has deleted, say. Its turn on the wire will decide its fate.
      }
    }
  }

  return {
    /** Queues a write. The caller has already applied it to the mirror. */
    async enqueue(
      kind: OpKind,
      itemId: string | null,
      payload: Record<string, unknown>,
    ): Promise<void> {
      await outbox.append(listId, kind, itemId, payload)
      publish({ pending: await outbox.count(listId) })
    },

    /** One full pass: send what is queued, then find out what has changed. */
    async cycle(): Promise<void> {
      const drained = await drain()

      try {
        if (drained) {
          await pull()
          publish({ live: true })
        } else {
          // Still offline. The mirror may hold a snapshot from before these ops
          // were made, so put the user's work back on top of it.
          await rebase(await outbox.peek(listId))
        }
      } catch {
        publish({ live: false })
      }

      for (const listener of listeners) listener()
    },

    state: () => state,

    /** Called with the connection state whenever it changes. */
    subscribe(fn: (state: SyncState) => void): () => void {
      watchers.add(fn)
      return () => void watchers.delete(fn)
    },

    /** Called after every cycle, so a caller can re-read the mirror. */
    onChange(fn: () => void): () => void {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }
}

export type Syncer = ReturnType<typeof createSyncer>
