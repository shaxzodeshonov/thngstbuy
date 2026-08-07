/**
 * The list, as the screens see it.
 *
 * Three layers meet here, and the order matters:
 *
 *  - `items` is React state, updated optimistically so a keystroke shows up in
 *    the frame it was typed in.
 *  - `mirror` is the device's copy, which survives the app being killed.
 *  - `outbox` + `sync` are what eventually tell the server.
 *
 * Every write goes to all three. The first is for the eye, the second is what
 * the app reads on next launch, and the third is what makes this list the same
 * list on someone else's phone.
 *
 * Two rules are inherited from the web app and still earn their place:
 *
 *  1. Text edits are debounced per item and written as field-level patches, so
 *     a `why` still inside its debounce window cannot carry an old `name` back
 *     into the row with it — and so two people editing different fields of the
 *     same thing don't overwrite each other.
 *  2. Backgrounding flushes those buffers, because on a phone it can be the last
 *     thing that happens before the OS reclaims the process.
 *
 * The polling loop lives here rather than in `sync.ts` because only this layer
 * knows whether anyone is looking at the screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import type { Item } from '@domain/types'
import * as Items from '@domain/items'
import { ApiError, api } from './api'
import { StoreError, mirror } from './mirror'
import { BACKOFF_MS, type SyncState, createSyncer } from './sync'
import { slugProblem } from './ids'

/** How long to sit on keystrokes before writing them through. */
const TYPING_SETTLE_MS = 450

/** How often a foregrounded screen checks whether anyone else has changed it. */
const POLL_MS = 3000

export type SyncStatus = 'loading' | 'ready' | 'missing' | 'error'

export type SyncedList = {
  items: Item[]
  status: SyncStatus
  error: string | null
  /** False when the last attempt to reach the server failed. */
  live: boolean
  /** Writes made here that the server has not acknowledged yet. */
  pending: number
  /** The list's name as the server knows it. Null until the first load lands. */
  slug: string | null
  add(name: string): Item | null
  update(id: string, patch: Partial<Item>): void
  toggleBought(id: string): void
  remove(id: string): void
  /** Resolves to null on success, or a message explaining why the name failed. */
  rename(next: string): Promise<string | null>
}

type Timer = ReturnType<typeof setTimeout>

export function useSyncedList(listId: string | null): SyncedList {
  const [items, setItems] = useState<Item[]>([])
  const [status, setStatus] = useState<SyncStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [slug, setSlug] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncState>({ live: true, pending: 0 })

  const syncer = useMemo(() => (listId ? createSyncer(listId) : null), [listId])

  /** Debounced field patches, keyed by item id. */
  const buffers = useRef(new Map<string, { patch: Partial<Item>; timer: Timer }>())

  /**
   * Mirrors `items` for callbacks that need the current value now. A `setItems`
   * updater runs during render, so anything read inside one is not available to
   * the write being fired alongside it.
   */
  const itemsRef = useRef(items)
  itemsRef.current = items

  /** Re-reads the device's copy into React state. */
  const reload = useCallback(async () => {
    if (!listId) return
    try {
      const state = await mirror.getList(listId)
      setSlug(state.slug)
      // A buffered edit is newer than anything the mirror can know about, so it
      // must not be overwritten by a reload that lands mid-typing.
      if (buffers.current.size === 0) setItems(state.items)
    } catch {
      // Not on this device. The load effect below decides what that means.
    }
  }, [listId])

  /* --------------------------------------------------------------- loading */

  useEffect(() => {
    if (!listId || !syncer) return
    let cancelled = false

    void (async () => {
      // Whatever is already on the device paints first, so opening the app on a
      // train is a list rather than a spinner.
      if (await mirror.has(listId)) {
        if (cancelled) return
        const local = await mirror.getList(listId)
        setSlug(local.slug)
        setItems(local.items)
        setStatus('ready')
      }

      try {
        const state = await api.getList(listId)
        if (cancelled) return
        await mirror.adopt(state, listId)
        await reload()
        setStatus('ready')
      } catch (failure) {
        if (cancelled) return

        // The server is the authority on whether a list exists — but only when
        // it can be reached. Offline with a local copy is a working app; offline
        // without one is the only case with nothing to show.
        if (failure instanceof ApiError && failure.status === 404) {
          setStatus('missing')
          return
        }
        if (await mirror.has(listId)) return

        setError(describe(failure))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [listId, reload, syncer])

  /* ------------------------------------------------------------------ sync */

  useEffect(() => {
    if (!syncer) return
    const stopWatching = syncer.subscribe(setSync)
    const stopListening = syncer.onChange(() => void reload())
    return () => {
      stopWatching()
      stopListening()
    }
  }, [reload, syncer])

  /**
   * Polling, not push. The backend is serverless — a write and someone else's
   * open connection can land on different instances, so there is nowhere to hold
   * a subscriber list.
   *
   * Only a foregrounded app polls. A backgrounded one asking every three seconds
   * would spend battery and hosting quota telling nobody anything. Returning to
   * the app checks immediately, so it is current the moment you look at it.
   */
  useEffect(() => {
    if (!syncer || status !== 'ready') return

    let stopped = false
    let timer: Timer | undefined
    let failures = 0

    const tick = async () => {
      if (stopped || AppState.currentState !== 'active') return
      await syncer.cycle()
      failures = syncer.state().live ? 0 : failures + 1
    }

    const loop = () => {
      // Backing off matters more here than on the web: a phone with no signal
      // would otherwise retry every three seconds for as long as it is held.
      const wait =
        failures === 0 ? POLL_MS : BACKOFF_MS[Math.min(failures - 1, BACKOFF_MS.length - 1)]

      timer = setTimeout(async () => {
        await tick()
        if (!stopped) loop()
      }, wait)
    }

    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return
      failures = 0
      void tick()
    })

    void tick()
    loop()

    return () => {
      stopped = true
      clearTimeout(timer)
      subscription.remove()
    }
  }, [status, syncer])

  /* ------------------------------------------------------------- mutations */

  const flush = useCallback(
    (itemId: string) => {
      const buffered = buffers.current.get(itemId)
      if (!buffered || !listId || !syncer) return

      clearTimeout(buffered.timer)
      buffers.current.delete(itemId)

      // An empty name would be rejected; keep it local until they type one.
      const patch = { ...buffered.patch }
      if (typeof patch.name === 'string' && patch.name.trim() === '') delete patch.name
      if (Object.keys(patch).length === 0) return

      void (async () => {
        try {
          await mirror.patchItem(listId, itemId, patch)
        } catch {
          // Already gone locally. The queued op will hear it from the server.
        }
        await syncer.enqueue('patchItem', itemId, patch as Record<string, unknown>)
        void syncer.cycle()
      })()
    },
    [listId, syncer],
  )

  const flushAll = useCallback(() => {
    for (const id of [...buffers.current.keys()]) flush(id)
  }, [flush])

  /**
   * Anything still inside the debounce window goes out now: backgrounding can be
   * the last thing that happens to an app before Android reclaims it, and a
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
      if (!trimmed || !listId || !syncer) return null

      const item = Items.createItem(trimmed)
      setItems((prev) => [...prev, item])

      void (async () => {
        await mirror.addItem(listId, { id: item.id, name: item.name })
        await syncer.enqueue('addItem', item.id, { id: item.id, name: item.name })
        void syncer.cycle()
      })()

      return item
    },
    [listId, syncer],
  )

  const toggleBought = useCallback(
    (id: string) => {
      if (!listId || !syncer) return
      flush(id)

      const current = itemsRef.current.find((i) => i.id === id)
      if (!current) return

      const next = !current.bought
      setItems((prev) => Items.toggleBought(prev, id))

      void (async () => {
        await mirror.patchItem(listId, id, { bought: next })
        await syncer.enqueue('patchItem', id, { bought: next })
        void syncer.cycle()
      })()
    },
    [flush, listId, syncer],
  )

  const remove = useCallback(
    (id: string) => {
      if (!listId || !syncer) return

      // Drop any queued edits for something that is about to not exist.
      const buffered = buffers.current.get(id)
      if (buffered) {
        clearTimeout(buffered.timer)
        buffers.current.delete(id)
      }

      setItems((prev) => Items.removeItem(prev, id))

      void (async () => {
        await mirror.removeItem(listId, id)
        await syncer.enqueue('removeItem', id, {})
        void syncer.cycle()
      })()
    },
    [listId, syncer],
  )

  // Never leave a timer pointing at an unmounted component.
  useEffect(() => {
    const buffered = buffers.current
    return () => {
      for (const [, entry] of buffered) clearTimeout(entry.timer)
      buffered.clear()
    }
  }, [])

  /**
   * Renaming is the one write that cannot be queued.
   *
   * Whether a name is free is a question only the server can answer, and an
   * optimistic rename that later lost would change a URL somebody had already
   * been given. So this goes straight out, and says so plainly when it can't.
   */
  const rename = useCallback(
    async (next: string): Promise<string | null> => {
      if (!listId) return 'Not ready yet.'

      const shape = slugProblem(next)
      if (shape) return shape

      try {
        const state = await api.renameList(listId, next)
        await mirror.adopt(state, listId)
        await reload()
        return null
      } catch (failure) {
        if (failure instanceof ApiError) return failure.message
        return 'Renaming needs a connection — try again once you are online.'
      }
    },
    [listId, reload],
  )

  return {
    items,
    status,
    error,
    live: sync.live,
    pending: sync.pending,
    slug,
    add,
    update,
    toggleBought,
    remove,
    rename,
  }
}

/** Turns a thrown value into one line a person can act on. */
export function describe(failure: unknown): string {
  if (failure instanceof ApiError) return `HTTP ${failure.status} — ${failure.message}`
  if (failure instanceof StoreError) return failure.message
  if (failure instanceof Error) return failure.message
  return String(failure)
}
