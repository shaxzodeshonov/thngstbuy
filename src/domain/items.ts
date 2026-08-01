/**
 * Item list rules. Pure functions over arrays — no React, no platform APIs.
 * These are the parts worth unit-testing and the parts React Native reuses
 * untouched.
 */

import type { Item } from './types'

export function createItem(name: string, now: Date = new Date()): Item {
  return {
    id: newId(),
    name: name.trim(),
    price: null,
    model: '',
    where: '',
    why: '',
    addedAt: now.toISOString(),
    bought: false,
    boughtAt: null,
  }
}

/**
 * `crypto.randomUUID` exists on modern web and on RN via `react-native-get-random-values`,
 * but we fall back so a missing polyfill degrades instead of crashing.
 */
function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Still-to-buy items, in the order they were added. */
export function pending(items: Item[]): Item[] {
  return items.filter((i) => !i.bought)
}

/** Bought items, most recently bought first. */
export function bought(items: Item[]): Item[] {
  return items
    .filter((i) => i.bought)
    .sort((a, b) => (b.boughtAt ?? '').localeCompare(a.boughtAt ?? ''))
}

/** What the list still costs you. Unpriced items count as zero. */
export function pendingTotal(items: Item[]): number {
  return pending(items).reduce((sum, i) => sum + (i.price ?? 0), 0)
}

/** True when at least one pending item has a price — otherwise we hide the total. */
export function hasPricedPending(items: Item[]): boolean {
  return pending(items).some((i) => i.price !== null)
}

/**
 * The counter shown next to an item on its detail screen: its 1-based position
 * among pending items. Bought items fall back to their position in the full list.
 */
export function positionOf(items: Item[], id: string): number {
  const inPending = pending(items).findIndex((i) => i.id === id)
  if (inPending !== -1) return inPending + 1
  return items.findIndex((i) => i.id === id) + 1
}

export function toggleBought(items: Item[], id: string, now: Date = new Date()): Item[] {
  return items.map((i) =>
    i.id === id
      ? { ...i, bought: !i.bought, boughtAt: i.bought ? null : now.toISOString() }
      : i,
  )
}

export function updateItem(items: Item[], id: string, patch: Partial<Item>): Item[] {
  return items.map((i) => (i.id === id ? { ...i, ...patch } : i))
}

export function removeItem(items: Item[], id: string): Item[] {
  return items.filter((i) => i.id !== id)
}

/** The item to focus after `id` is removed or bought — keeps the pane populated. */
export function neighbourOf(items: Item[], id: string): string | null {
  const list = pending(items)
  const index = list.findIndex((i) => i.id === id)
  if (index === -1) return list[0]?.id ?? null
  const next = list[index + 1] ?? list[index - 1]
  return next?.id ?? null
}
