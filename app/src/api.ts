import Constants from 'expo-constants'
import type { Item } from '@domain/types'

/**
 * Same REST API the website uses. The only difference from the web client is
 * that requests need an absolute URL, since there is no origin to be relative to.
 */
const BASE =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'https://thngstbuy.vercel.app'

export type ListState = {
  slug: string
  version: number
  items: Item[]
}

/** Identifies this device so the server can tag its own echo. */
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
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId,
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string })
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<T>
}

export const api = {
  baseUrl: BASE,

  createList: () => request<ListState>('/lists', { method: 'POST' }),

  getList: (id: string) => request<ListState>(`/lists/${id}`),

  renameList: (id: string, slug: string) =>
    request<ListState>(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify({ slug }) }),

  addItem: (id: string, item: { id: string; name: string }) =>
    request<ListState>(`/lists/${id}/items`, { method: 'POST', body: JSON.stringify(item) }),

  patchItem: (id: string, itemId: string, patch: Partial<Item>) =>
    request<ListState>(`/lists/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  removeItem: (id: string, itemId: string) =>
    request<ListState>(`/lists/${id}/items/${itemId}`, { method: 'DELETE' }),

  getVersion: (id: string) => request<{ version: number }>(`/lists/${id}/version`),
}
