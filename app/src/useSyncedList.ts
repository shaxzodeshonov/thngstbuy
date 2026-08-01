/**
 * The list, shared. Ported from the web app's src/data/useSyncedList.ts — the
 * reconciliation rules are identical, because the failure they prevent is the
 * same on both. Only three things changed: AppState replaces the browser's
 * visibility events, timer types are React Native's, and there is no
 * `window`.
 *
 *  1. A server snapshot is only adopted when this client has no writes in
 *     flight. Otherwise it's marked stale and re-fetched once the writes settle,
 *     so we converge without ever reverting a keystroke the user just made.
 *  2. Text edits are debounced per item and sent as field-level patches, so two
 *     people editing different fields of the same thing don't overwrite each
 *     other.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Item } from '@domain/types'
import * as Items from '@domain/items'
import { ApiError, type ListState, api } from './api'
import { storage } from './storage'

const TYPING_SETTLE_MS = 450
const POLL_MS = 3000

export type SyncStatus = 'loading' | 'ready' | 'missing' | 'error'

export type SyncedList = {
  items: Item[]
  status: SyncStatus
  error: string | null
  live: boolean
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
  const [live, setLive] = useState(false)
  const [slug, setSlug] = useState<string | null>(null)

  const inFlight = useRef(0)
  const stale = useRef(false)
  const version = useRef(-1)
  const buffers = useRef(new Map<string, { patch: Partial<Item>; timer: Timer }>())

  /**
   * Mirrors `items` for callbacks that need the current value now. A `setItems`
   * updater runs during render, so anything read inside one is not available to
   * the request being fired alongside it.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items

  const adopt = useCallback((state: ListState) => {
    version.current = state.version
    setSlug(state.slug)
    setItems(state.items)
    void storage.set(cacheKey(state.slug), JSON.stringify(state.items))
  }, [])

  const reconcile = useCallback(async () => {
    if (!listId) return
    try {
      adopt(await api.getList(listId))
    } catch {
      // Offline. The next poll will resync.
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

  /* --------------------------------------------------------- load + poll */

  useEffect(() => {
    if (!listId) return
    let cancelled = false

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
      .catch((failure: unknown) => {
        if (cancelled) return
        if (failure instanceof ApiError && failure.status === 404) {
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

  /**
   * Only a foregrounded app polls. Backgrounded, there is nobody looking and
   * the requests would burn battery and hosting quota for nothing. Coming back
   * to the foreground checks straight away, so it is current the moment it is
   * on screen.
   */
  useEffect(() => {
    if (!listId || status !== 'ready') return

    let stopped = false
    let timer: Timer | undefined

    async function check() {
      if (stopped || !listId) return
      if (AppState.currentState !== 'active' || inFlight.current > 0) return

      try {
        const { version: latest } = await api.getVersion(listId)
        setLive(true)
        if (stopped || latest === version.current) return

        const state = await api.getList(listId)
        if (!stopped && inFlight.current === 0) adopt(state)
      } catch {
        setLive(false)
      }
    }

    function schedule() {
      timer = setTimeout(async () => {
        await check()
        if (!stopped) schedule()
      }, POLL_MS)
    }

    void check()
    schedule()

    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void check()
      // Anything still inside the debounce window goes out now: backgrounding
      // can be the last thing that happens to an app.
      else flushAll()
    })

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      subscription.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adopt, listId, status])

  /* ------------------------------------------------------------ mutations */

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

  const flushAll = useCallback(() => {
    for (const id of [...buffers.current.keys()]) flush(id)
  }, [flush])

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

  const rename = useCallback(
    async (next: string): Promise<string | null> => {
      if (!listId) return 'Not connected yet.'
      inFlight.current++
      try {
        adopt(await api.renameList(listId, next))
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

  return { items, status, error, live, slug, add, update, toggleBought, remove, rename }
}

const cacheKey = (listId: string) => `thngstbuy.cache.${listId}`

export function describe(failure: unknown): string {
  if (failure instanceof ApiError) return `HTTP ${failure.status} — ${failure.message}`
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
