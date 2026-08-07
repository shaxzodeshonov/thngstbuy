/**
 * The list. Ported from the web app's src/data/useSyncedList.ts, then trimmed
 * when the backend became a SQLite file on this device rather than a server.
 *
 * Two of the three original rules survive the move, because what they protect
 * against is local:
 *
 *  1. A snapshot is only adopted when there are no writes in flight. A write
 *     returns the whole new state, and a slow one landing after a faster one
 *     would otherwise put a stale copy on screen.
 *  2. Text edits are debounced per item and written as field-level patches, so
 *     a `why` still inside its debounce window can't carry an old `name` back
 *     into the row with it.
 *
 * The third — polling for someone else's changes — is gone. Nothing but this
 * app can write to the database, so a timer asking every three seconds could
 * only ever find its own last write, at the cost of waking the device for it.
 * Backgrounding still flushes the debounce buffers, which is the one thing the
 * AppState listener was really needed for.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Item } from '@domain/types'
import * as Items from '@domain/items'
import { StoreError, type ListState, store } from './localStore'
import { storage } from './storage'

const TYPING_SETTLE_MS = 450

export type SyncStatus = 'loading' | 'ready' | 'missing' | 'error'

export type SyncedList = {
  items: Item[]
  status: SyncStatus
  error: string | null
  slug: string | null
  add(name: string): Item | null
  update(id: string, patch: Partial<Item>): void
  toggleBought(id: string): void
  remove(id: string): void
  rename(next: string): Promise<string | null>
}

type Timer = ReturnType<typeof setTimeout>

export function useSyncedList(listId: string | null): SyncedList {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)

  const inFlight = useRef(0)
  const stale = useRef(false)
  const buffers = useRef(new Map<string, { patch: Partial<Item>; timer: Timer }>())

  /**
   * Mirrors `items` for callbacks that need the current value now. A `setItems`
   * updater runs during render, so anything read inside one is not available to
   * the write being fired alongside it.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items

  const adopt = useCallback((state: ListState) => {
    setSlug(state.slug)
    setItems(state.items)
    void storage.set(cacheKey(state.slug), JSON.stringify(state.items))
  }, [])

  const reconcile = useCallback(async () => {
    if (!listId) return
    try {
      adopt(await store.getList(listId))
    } catch {
      // The list went away underneath us. The next interaction will say so.
    }
  }, [adopt, listId])

  const endWrite = useCallback(() => {
    inFlight.current = Math.max(0, inFlight.current - 1)
    if (inFlight.current === 0 && stale.current) {
      stale.current = false
      void reconcile()
    }
  }, [reconcile])

  const write = useCallback(
    async (run: () => Promise<ListState>) => {
      inFlight.current++
      try {
        const state = await run()
        if (inFlight.current === 1) adopt(state)
      } catch {
        stale.current = true
      } finally {
        endWrite()
      }
    },
    [adopt, endWrite],
  )

  /* --------------------------------------------------------------- loading */

  useEffect(() => {
    if (!listId) return
    let cancelled = false

    /**
     * The cached copy paints first. Reading SQLite is fast, but it is still a
     * round trip through a native module, and the list is what the app is —
     * showing it a frame early is worth the twenty lines.
     */
    void storage.get(cacheKey(listId)).then((raw) => {
      if (cancelled || !raw) return
      setItems((current) => (current.length === 0 ? safeParse(raw) : current))
    })

    store
      .getList(listId)
      .then((state) => {
        if (cancelled) return
        adopt(state)
        setStatus('ready')
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        if (failure instanceof StoreError && failure.code === 'missing') {
          setStatus('missing')
          return
        }
        setError(describe(failure))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [adopt, listId])

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
          const state = await store.patchItem(listId, itemId, patch)
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

  const flushAll = useCallback(() => {
    for (const id of [...buffers.current.keys()]) flush(id)
  }, [flush])

  /**
   * Anything still inside the debounce window goes out now: backgrounding can
   * be the last thing that happens to an app before Android reclaims it, and a
   * dropped buffer is a sentence the user typed and watched disappear.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') flushAll()
    })
    return () => subscription.remove()
  }, [flushAll])

  const update = useCallback(
    (id: string, patch: Partial<Item>) => {
      setItems((prev) => Items.updateItem(prev, id, patch))

      const existing = buffers.current.get(id)
      if (existing) clearTimeout(existing.timer)
      // One in-flight slot per buffered item, claimed when the buffer opens.
      else inFlight.current++

      buffers.current.set(id, {
        patch: { ...existing?.patch, ...patch },
        timer: setTimeout(() => flush(id), TYPING_SETTLE_MS),
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
      void write(() => store.addItem(listId, { id: item.id, name: item.name }))
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
      void write(() => store.patchItem(listId, id, { bought: next }))
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
      void write(() => store.removeItem(listId, id))
    },
    [endWrite, listId, write],
  )

  const rename = useCallback(
    async (next: string): Promise<string | null> => {
      if (!listId) return 'Not ready yet.'
      inFlight.current++
      try {
        adopt(await store.renameList(listId, next))
        return null
      } catch (failure) {
        return describe(failure)
      } finally {
        endWrite()
      }
    },
    [adopt, endWrite, listId],
  )

  useEffect(() => {
    const buffered = buffers.current
    return () => {
      for (const [, entry] of buffered) clearTimeout(entry.timer)
      buffered.clear()
    }
  }, [])

  return { items, status, error, slug, add, update, toggleBought, remove, rename }
}

const cacheKey = (listId: string) => `thngstbuy.cache.${listId}`

export function describe(failure: unknown): string {
  if (failure instanceof StoreError) return failure.message
  if (failure instanceof Error) return failure.message
  return String(failure)
}

function safeParse(raw: string): Item[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Item[]) : []
  } catch {
    return []
  }
}
