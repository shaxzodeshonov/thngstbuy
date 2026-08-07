/**
 * The server, from the phone. A port of the web app's src/data/api.ts, which it
 * deliberately still resembles: same method names, same "every write returns the
 * whole new state" contract, so the reconciliation rules written against one
 * work against the other.
 *
 * Three things differ, all because this runs on a phone rather than in a tab:
 * the base URL is absolute, requests time out, and there is no `credentials`
 * notion because there are no cookies — a list URL is the only credential this
 * app has.
 */

import type { Item } from '@domain/types'
import { API_BASE } from './config'

/**
 * What every list endpoint returns. `slug` is the name in the URL — it can be
 * renamed, so it is what the client mirrors back into its own state after a
 * write.
 */
export type ListState = {
  slug: string
  version: number
  items: Item[]
}

/** Identifies this device, so the server can attribute a write to it. */
export const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36)

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * A phone loses signal mid-request far more often than a browser does, and
 * without a deadline the promise can sit unresolved until the OS gives up
 * minutes later. The syncer treats a timeout as "offline and try again", which
 * is both true and recoverable; an un-resolving promise would instead look like
 * a queue that has stopped for no reason.
 */
const TIMEOUT_MS = 15_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId,
        ...init?.headers,
      },
    })

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
    }

    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  /** Start a new list. The response slug becomes the shareable link. */
  createList: () => request<ListState>('/lists', { method: 'POST' }),

  getList: (ref: string) => request<ListState>(`/lists/${ref}`),

  /**
   * The cheapest call in the app. The syncer asks for this on a timer and only
   * fetches the whole list when the number has moved.
   */
  getVersion: (ref: string) => request<{ version: number }>(`/lists/${ref}/version`),

  /** Give the list a chosen name. The generated link keeps working afterwards. */
  renameList: (ref: string, slug: string) =>
    request<ListState>(`/lists/${ref}`, { method: 'PATCH', body: JSON.stringify({ slug }) }),

  addItem: (ref: string, item: { id: string; name: string }) =>
    request<ListState>(`/lists/${ref}/items`, { method: 'POST', body: JSON.stringify(item) }),

  /**
   * Field-level: only the keys present are sent. This is the property the whole
   * offline design rests on — it is what lets a queue of these replay as a merge
   * rather than as a series of overwrites.
   */
  patchItem: (ref: string, itemId: string, patch: Partial<Item>) =>
    request<ListState>(`/lists/${ref}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeItem: (ref: string, itemId: string) =>
    request<ListState>(`/lists/${ref}/items/${itemId}`, { method: 'DELETE' }),
}
