import type { Item } from '@/domain/types'

/** What every list endpoint returns. */
export type ListState = {
  id: string
  version: number
  items: Item[]
}

/** Identifies this browser tab so it can ignore the echo of its own writes. */
export const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36)

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export const api = {
  createList: () => request<ListState>('/lists', { method: 'POST' }),

  getList: (id: string) => request<ListState>(`/lists/${id}`),

  addItem: (id: string, item: { id: string; name: string }) =>
    request<ListState>(`/lists/${id}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  patchItem: (id: string, itemId: string, patch: Partial<Item>) =>
    request<ListState>(`/lists/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeItem: (id: string, itemId: string) =>
    request<ListState>(`/lists/${id}/items/${itemId}`, { method: 'DELETE' }),

  /**
   * The cheapest call in the app. Clients ask for this on a timer and only
   * fetch the whole list when the number has moved.
   */
  getVersion: (id: string) => request<{ version: number }>(`/lists/${id}/version`),
}
