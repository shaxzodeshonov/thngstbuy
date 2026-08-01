/**
 * The list, shared. Everything is optimistic locally and reconciled against the
 * server, which is the single source of truth.
 *
 * The two rules that keep concurrent editors from fighting:
 *
 *  1. A server snapshot is only adopted when this client has no writes in
 *     flight. Otherwise it's marked stale and re-fetched once the writes settle,
 *     so we converge without ever reverting a keystroke the user just made.
 *  2. Text edits are debounced per item and sent as field-level patches, so two
 *     people editing different fields of the same thing don't overwrite each
 *     other.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item } from '@/domain/types'
import * as Items from '@/domain/items'
import { ApiError, type ListState, api } from './api'
import { storage } from './storage'

/** How long to sit on keystrokes before writing them through. */
const TYPING_SETTLE_MS = 450

/** How often a visible tab checks whether anyone else has changed the list. */
const POLL_MS = 3000

export type SyncStatus = 'loading' | 'ready' | 'missing' | 'error'

export type SyncedList = {
  items: Item[]
  status: SyncStatus
  /** False when the last poll failed — edits still apply locally and reconcile. */
  live: boolean
  add(name: string): Item | null
  update(id: string, patch: Partial<Item>): void
  toggleBought(id: string): void
  remove(id: string): void
}

export function useSyncedList(listId: string | null): SyncedList {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [live, setLive] = useState(false)

  /** Writes started but not yet acknowledged, including debounced ones. */
  const inFlight = useRef(0)
  /** A snapshot arrived while we were mid-write, so our copy may be behind. */
  const stale = useRef(false)
  /** Debounced field patches, keyed by item id. */
  const buffers = useRef(new Map<string, { patch: Partial<Item>; timer: number }>())

  /**
   * Mirrors `items` for callbacks that need the current value *now*. A
   * `setItems` updater runs during render, so anything read inside one is not
   * available to the request being fired alongside it.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items

  /** Last version we've seen, so polling knows when there's anything to fetch. */
  const version = useRef(-1)

  const adopt = useCallback((state: ListState) => {
    version.current = state.version
    setItems(state.items)
    void storage.set(cacheKey(state.id), JSON.stringify(state.items))
  }, [])

  const reconcile = useCallback(async () => {
    if (!listId) return
    try {
      adopt(await api.getList(listId))
    } catch {
      // Offline. The stream's reconnect will resync.
    }
  }, [adopt, listId])

  const endWrite = useCallback(() => {
    inFlight.current = Math.max(0, inFlight.current - 1)
    if (inFlight.current === 0 && stale.current) {
      stale.current = false
      void reconcile()
    }
  }, [reconcile])

  /** Runs a mutation, keeping the in-flight count honest on both paths. */
  const write = useCallback(
    async (run: () => Promise<ListState>) => {
      inFlight.current++
      try {
        const state = await run()
        if (inFlight.current === 1) adopt(state)
      } catch {
        // Leave the optimistic value in place; reconcile will settle it.
        stale.current = true
      } finally {
        endWrite()
      }
    },
    [adopt, endWrite],
  )

  /* --------------------------------------------------------- load + stream */

  useEffect(() => {
    if (!listId) return
    let cancelled = false

    // Show the cached copy first so a reload isn't a blank card.
    void storage.get(cacheKey(listId)).then((raw) => {
      if (cancelled || !raw) return
      setItems((current) => (current.length === 0 ? safeParse(raw) : current))
    })

    api
      .getList(listId)
      .then((state) => {
        if (cancelled) return
        adopt(state)
        setStatus('ready')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setStatus(error instanceof ApiError && error.status === 404 ? 'missing' : 'error')
      })

    return () => {
      cancelled = true
    }
  }, [adopt, listId])

  /**
   * Polling, not push. The server is serverless — a write and someone else's
   * open connection can land on different instances, so there is nowhere to
   * hold a subscriber list.
   *
   * Only visible tabs poll. A backgrounded tab that kept asking every few
   * seconds would burn through the hosting quota for nothing, and there is
   * nobody looking at it anyway. Switching back checks immediately, so it feels
   * current the moment you return.
   */
  useEffect(() => {
    if (!listId || status !== 'ready') return

    let stopped = false
    let timer: number | undefined

    async function check() {
      if (stopped || !listId) return
      if (document.visibilityState !== 'visible' || inFlight.current > 0) return

      try {
        const { version: latest } = await api.getVersion(listId)
        setLive(true)
        if (stopped || latest === version.current) return

        const state = await api.getList(listId)
        // A write may have started while that was in the air; its own response
        // is newer than this snapshot.
        if (!stopped && inFlight.current === 0) adopt(state)
      } catch {
        setLive(false)
      }
    }

    function schedule() {
      timer = window.setTimeout(async () => {
        await check()
        if (!stopped) schedule()
      }, POLL_MS)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }

    void check()
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [adopt, listId, status])

  /* ------------------------------------------------------------- mutations */

  const flush = useCallback(
    (itemId: string) => {
      const buffered = buffers.current.get(itemId)
      if (!buffered) return

      clearTimeout(buffered.timer)
      buffers.current.delete(itemId)

      // An empty name would be rejected; keep it local until they type one.
      const patch = { ...buffered.patch }
      if (typeof patch.name === 'string' && patch.name.trim() === '') delete patch.name

      if (!listId || Object.keys(patch).length === 0) {
        endWrite()
        return
      }

      void (async () => {
        try {
          const state = await api.patchItem(listId, itemId, patch)
          if (inFlight.current === 1) adopt(state)
        } catch {
          stale.current = true
        } finally {
          endWrite()
        }
      })()
    },
    [adopt, endWrite, listId],
  )

  const update = useCallback(
    (id: string, patch: Partial<Item>) => {
      setItems((prev) => Items.updateItem(prev, id, patch))

      const existing = buffers.current.get(id)
      if (existing) clearTimeout(existing.timer)
      // One in-flight slot per buffered item, claimed when the buffer opens.
      else inFlight.current++

      buffers.current.set(id, {
        patch: { ...existing?.patch, ...patch },
        timer: window.setTimeout(() => flush(id), TYPING_SETTLE_MS),
      })
    },
    [flush],
  )

  const add = useCallback(
    (name: string): Item | null => {
      const trimmed = name.trim()
      if (!trimmed || !listId) return null

      const item = Items.createItem(trimmed)
      setItems((prev) => [...prev, item])
      void write(() => api.addItem(listId, { id: item.id, name: item.name }))
      return item
    },
    [listId, write],
  )

  const toggleBought = useCallback(
    (id: string) => {
      if (!listId) return
      flush(id)

      const current = itemsRef.current.find((i) => i.id === id)
      if (!current) return

      const next = !current.bought
      setItems((prev) => Items.toggleBought(prev, id))
      void write(() => api.patchItem(listId, id, { bought: next }))
    },
    [flush, listId, write],
  )

  const remove = useCallback(
    (id: string) => {
      if (!listId) return

      // Drop any queued edits for something that's about to not exist.
      const buffered = buffers.current.get(id)
      if (buffered) {
        clearTimeout(buffered.timer)
        buffers.current.delete(id)
        endWrite()
      }

      setItems((prev) => Items.removeItem(prev, id))
      void write(() => api.removeItem(listId, id))
    },
    [endWrite, listId, write],
  )

  /**
   * Backgrounding a tab on a phone can be the last thing that happens to it, so
   * anything still inside the debounce window goes out now rather than waiting.
   */
  useEffect(() => {
    const flushAll = () => {
      for (const id of [...buffers.current.keys()]) flush(id)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushAll()
    }

    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushAll)

    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushAll)
    }
  }, [flush])

  // Never leave a timer pointing at an unmounted component.
  useEffect(() => {
    const buffered = buffers.current
    return () => {
      for (const [, entry] of buffered) clearTimeout(entry.timer)
      buffered.clear()
    }
  }, [])

  return { items, status, live, add, update, toggleBought, remove }
}

const cacheKey = (listId: string) => `thngstbuy.cache.${listId}`

function safeParse(raw: string): Item[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Item[]) : []
  } catch {
    return []
  }
}
