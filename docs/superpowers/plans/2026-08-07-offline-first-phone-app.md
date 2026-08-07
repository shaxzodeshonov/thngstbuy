# Offline-first phone app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `app/` a full peer of the website — same lists, shared by link — while keeping it usable with the network off.

**Architecture:** The device's SQLite file stops being the truth and becomes a mirror of server state. Every write applies to the mirror and appends an op to a durable outbox in one transaction; a syncer replays those ops as ordinary API calls when the network allows. Because the server takes field-level patches keyed by client-generated UUIDs, replaying the queue *is* the merge — the work is making replay idempotent and never letting a pulled snapshot erase an unsent edit.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 5.9, `expo-sqlite` on device, `node:sqlite` in tests, Vitest, Express 5 backend.

**Spec:** [`../specs/2026-08-07-offline-first-phone-app-design.md`](../specs/2026-08-07-offline-first-phone-app-design.md)

## Global Constraints

- **Node >= 22.5** (root `package.json` engines) — `node:sqlite` requires it.
- **No new runtime dependency beyond `react-native-get-random-values`.** Connection state is inferred from request outcomes, not from NetInfo, which routinely reports "connected" on a captive portal.
- **`src/domain/` is shared verbatim** with the web app and resolved by Metro as `@domain`. Changing it changes the website — only `items.ts`'s id generation is touched, and only in a way the website already expects.
- **Field-level patches only.** Never PUT a whole item; the merge semantics depend on this.
- **Ops replay oldest-first per list, and draining stops at the first transient failure.** A later op must never land before an earlier one.
- **API base URL:** `https://thngstbuy.vercel.app`.
- **The 500-item cap, 200/500/500/2000-character field limits and `MAX_PRICE` of 1e12** are the server's and must not be re-litigated client-side.
- **Never bundle `node:sqlite` into the app.** The Node adapter lives in `app/src/testing/`, which no app module imports.
- Commit after every task.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app/src/sqlite.ts` | **new** — `Adapter` interface, expo-sqlite impl, test override seam |
| `app/src/testing/nodeAdapter.ts` | **new** — `node:sqlite` adapter, test-only |
| `app/src/mirror.ts` | **renamed** from `localStore.ts` — local replica; gains `adopt()` |
| `app/src/outbox.ts` | **new** — durable op log |
| `app/src/api.ts` | **new** — networked client, absolute base URL |
| `app/src/config.ts` | **new** — API base URL + dev override |
| `app/src/sync.ts` | **new** — drain, pull, rebase, backoff, connection state |
| `app/src/useSyncedList.ts` | **rewritten** — sits on `sync.ts` |
| `app/src/ListScreen.tsx` | **modified** — Share button, sync status marker |
| `app/src/NameScreen.tsx` | **modified** — online-only rename |
| `app/App.tsx` | **modified** — online-only create, share handler |
| `app/index.js` | **modified** — UUID polyfill import, first |
| `app/src/ids.ts` | **modified** — drop `newListId` |
| `server/db.js` | **modified:189** — `ON CONFLICT(id) DO NOTHING` |
| `app/android/app/src/main/AndroidManifest.xml` | **modified** — https intent filter |
| `README.md`, `app/README.md` | **rewritten** phone sections |

---

## Task 1: Test harness and the SQLite seam

Nothing in this repo has tests. This task builds the harness and proves it by putting the existing store behind an adapter, unchanged in behaviour.

**Files:**
- Create: `app/vitest.config.ts`, `app/src/sqlite.ts`, `app/src/testing/nodeAdapter.ts`
- Modify: `app/package.json`, `app/src/localStore.ts` → `app/src/mirror.ts`
- Test: `app/src/mirror.test.ts`

**Interfaces produced:**

```ts
// app/src/sqlite.ts
export type Row = Record<string, any>
export type Adapter = {
  execute(sql: string, args?: unknown[]): Promise<{ rows: Row[]; changes: number }>
  executeScript(sql: string): Promise<void>
  transaction<T>(run: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
export function getAdapter(): Promise<Adapter>
/** Test seam. Resets the memoised adapter. */
export function useAdapter(factory: (() => Promise<Adapter>) | null): void
```

- [ ] **Step 1: Add Vitest to the app package**

```bash
cd app && npm install -D vitest@^3
```

Add to `app/package.json` scripts: `"test": "vitest run"`, `"test:watch": "vitest"`.

- [ ] **Step 2: Write `app/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@domain': path.resolve(__dirname, '../src/domain') },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
```

- [ ] **Step 3: Write the failing test** — `app/src/mirror.test.ts`

```ts
import { beforeEach, expect, test } from 'vitest'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { mirror } from './mirror'

beforeEach(() => useAdapter(() => createNodeAdapter(':memory:')))

test('adopting a server snapshot replaces local items', async () => {
  await mirror.adopt({
    slug: 'shaxzod',
    version: 4,
    items: [
      { id: 'a'.repeat(36), name: 'Kettle', price: null, model: '', where: '',
        why: '', addedAt: '2026-08-07T00:00:00.000Z', bought: false, boughtAt: null },
    ],
  })

  const state = await mirror.getList('shaxzod')
  expect(state.version).toBe(4)
  expect(state.items.map((i) => i.name)).toEqual(['Kettle'])
})

test('a second adopt removes items the server no longer has', async () => {
  const base = { price: null, model: '', where: '', why: '',
    addedAt: '2026-08-07T00:00:00.000Z', bought: false, boughtAt: null }
  await mirror.adopt({ slug: 'shaxzod', version: 1, items: [
    { id: 'a'.repeat(36), name: 'Kettle', ...base },
    { id: 'b'.repeat(36), name: 'Lamp', ...base },
  ] })
  await mirror.adopt({ slug: 'shaxzod', version: 2, items: [
    { id: 'b'.repeat(36), name: 'Lamp', ...base },
  ] })

  const state = await mirror.getList('shaxzod')
  expect(state.items.map((i) => i.name)).toEqual(['Lamp'])
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd app && npm test`
Expected: FAIL — `./mirror` and `./testing/nodeAdapter` do not exist.

- [ ] **Step 5: Write `app/src/testing/nodeAdapter.ts`**

Mirrors `server/adapters.js`'s file adapter. Test-only; never imported by app code.

```ts
import { DatabaseSync } from 'node:sqlite'
import type { Adapter } from '../sqlite'

const reads = /^\s*(select|pragma|with|explain)/i

export async function createNodeAdapter(file = ':memory:'): Promise<Adapter> {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON;')

  return {
    async execute(sql, args = []) {
      const stmt = db.prepare(sql)
      if (reads.test(sql)) return { rows: stmt.all(...(args as any[])), changes: 0 }
      const result = stmt.run(...(args as any[]))
      return { rows: [], changes: Number(result.changes ?? 0) }
    },
    async executeScript(sql) {
      db.exec(sql)
    },
    async transaction(run) {
      db.exec('BEGIN')
      try {
        const value = await run()
        db.exec('COMMIT')
        return value
      } catch (failure) {
        db.exec('ROLLBACK')
        throw failure
      }
    },
    async close() {
      db.close()
    },
  }
}
```

- [ ] **Step 6: Write `app/src/sqlite.ts`**

```ts
/**
 * One SQL dialect, two places to run it — the same split `server/adapters.js`
 * makes. On the phone it is expo-sqlite; in tests it is node:sqlite, so the
 * statements the app really runs are the statements the tests really exercise.
 */
import * as SQLite from 'expo-sqlite'

export type Row = Record<string, any>

export type Adapter = {
  execute(sql: string, args?: unknown[]): Promise<{ rows: Row[]; changes: number }>
  executeScript(sql: string): Promise<void>
  transaction<T>(run: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

const reads = /^\s*(select|pragma|with|explain)/i

async function createExpoAdapter(): Promise<Adapter> {
  const handle = await SQLite.openDatabaseAsync('thngstbuy.db')

  return {
    async execute(sql, args = []) {
      if (reads.test(sql)) {
        return { rows: await handle.getAllAsync<Row>(sql, ...(args as any[])), changes: 0 }
      }
      const result = await handle.runAsync(sql, ...(args as any[]))
      return { rows: [], changes: result.changes }
    },
    executeScript: (sql) => handle.execAsync(sql),
    transaction: (run) => handle.withTransactionAsync(run),
    close: () => handle.closeAsync(),
  }
}

let override: (() => Promise<Adapter>) | null = null
let opening: Promise<Adapter> | undefined

/** Test seam. Passing null restores the real one. */
export function useAdapter(factory: (() => Promise<Adapter>) | null): void {
  override = factory
  opening = undefined
  schemaDone = false
}

let schemaDone = false

export function getAdapter(): Promise<Adapter> {
  opening ??= (async () => {
    const adapter = await (override ?? createExpoAdapter)()
    if (!schemaDone) {
      await adapter.executeScript(SCHEMA)
      schemaDone = true
    }
    return adapter
  })()
  return opening
}

export const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS lists (
    id         TEXT PRIMARY KEY,
    slug       TEXT,
    version    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id        TEXT PRIMARY KEY,
    list_id   TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name      TEXT NOT NULL,
    price     INTEGER,
    model     TEXT NOT NULL DEFAULT '',
    where_to  TEXT NOT NULL DEFAULT '',
    why       TEXT NOT NULL DEFAULT '',
    added_at  TEXT NOT NULL,
    bought    INTEGER NOT NULL DEFAULT 0,
    bought_at TEXT,
    position  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS items_by_list ON items (list_id, position);
  CREATE UNIQUE INDEX IF NOT EXISTS lists_by_slug ON lists (slug);

  CREATE TABLE IF NOT EXISTS outbox (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    item_id    TEXT,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS outbox_by_list ON outbox (list_id, seq);

  CREATE TABLE IF NOT EXISTS sync_meta (
    list_id      TEXT PRIMARY KEY,
    last_version INTEGER NOT NULL
  );
`
```

Note the `WAL` pragma from `localStore.ts` is dropped: `node:sqlite` in-memory rejects it, and expo-sqlite already opens WAL by default.

- [ ] **Step 7: Convert `localStore.ts` into `mirror.ts`**

```bash
cd app && git mv src/localStore.ts src/mirror.ts
```

Then, in `mirror.ts`:
- Delete the local `SCHEMA` const and the `db()` function; import `getAdapter` and use it.
- Replace every `handle.getFirstAsync<T>(sql, ...args)` with `(await (await getAdapter()).execute(sql, args)).rows[0] as T | undefined`.
- Replace every `handle.getAllAsync<T>(sql, ...args)` with `(await (await getAdapter()).execute(sql, args)).rows as T[]`.
- Replace every `handle.runAsync(sql, ...args)` with `(await getAdapter()).execute(sql, args)`.
- Rename the export `store` → `mirror`, keeping `StoreError` and `ListState` exactly as they are.
- Delete `createList` — the server mints list ids now (Task 5 adds the networked one).
- Add `adopt`, below.

```ts
/**
 * Replaces the local copy of a list with the server's. Runs in one transaction:
 * a half-applied snapshot would be a list that never existed anywhere.
 */
async adopt(state: ListState): Promise<void> {
  const adapter = await getAdapter()
  const now = new Date().toISOString()

  await adapter.transaction(async () => {
    const existing = (await adapter.execute(
      `SELECT id FROM lists WHERE slug = ? OR id = ? LIMIT 1`, [state.slug, state.slug],
    )).rows[0] as { id: string } | undefined

    const listId = existing?.id ?? state.slug
    if (!existing) {
      await adapter.execute(
        `INSERT INTO lists (id, slug, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        [listId, state.slug, state.version, now, now],
      )
    } else {
      await adapter.execute(
        `UPDATE lists SET slug = ?, version = ?, updated_at = ? WHERE id = ?`,
        [state.slug, state.version, now, listId],
      )
    }

    await adapter.execute(`DELETE FROM items WHERE list_id = ?`, [listId])

    let position = 1
    for (const item of state.items) {
      await adapter.execute(
        `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [item.id, listId, item.name, item.price, item.model, item.where, item.why,
         item.addedAt, item.bought ? 1 : 0, item.boughtAt, position++],
      )
    }

    await adapter.execute(
      `INSERT INTO sync_meta (list_id, last_version) VALUES (?, ?)
       ON CONFLICT(list_id) DO UPDATE SET last_version = excluded.last_version`,
      [listId, state.version],
    )
  })
}
```

Delete-then-reinsert is correct here rather than wasteful: the snapshot is authoritative, item count is capped at 500, and a diff would have to reproduce the server's ordering anyway.

- [ ] **Step 8: Update the two importers**

`App.tsx` and `useSyncedList.ts` import `{ store } from './localStore'`. Change both to `{ mirror } from './mirror'` and rename usages. `App.tsx`'s `store.createList()` call is fixed in Task 5; for now, make it `mirror.getList` compile by leaving the call site alone and expecting the typecheck failure to be resolved there.

- [ ] **Step 9: Run the tests**

Run: `cd app && npm test`
Expected: PASS, 2 tests.

- [ ] **Step 10: Commit**

```bash
git add -A app/
git commit -m "Put the device database behind an adapter, and test it

Same split server/adapters.js makes: expo-sqlite on the phone, node:sqlite
under vitest, so the statements the app runs are the ones the tests exercise.
localStore becomes mirror, because it is about to stop being the truth."
```

---

## Task 2: Real UUIDs on the device

**Files:**
- Modify: `app/index.js`, `app/package.json`, `app/src/ids.ts`
- Test: `app/src/ids.test.ts`

Without this, the server rejects the client's item id and mints its own (`server/app.js:283` requires exactly 36 characters), so an optimistic row and the stored row are different items and every replayed add duplicates.

- [ ] **Step 1: Write the failing test** — `app/src/ids.test.ts`

```ts
import { expect, test } from 'vitest'
import { createItem } from '@domain/items'

/** Copied verbatim from server/app.js:283. If that changes, this must too. */
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

test('a new item carries an id the server will accept as its own', () => {
  for (let i = 0; i < 50; i++) {
    expect(isUuid(createItem('Kettle').id)).toBe(true)
  }
})
```

- [ ] **Step 2: Run it**

Run: `cd app && npm test src/ids.test.ts`
Expected: PASS under Node (which has `crypto.randomUUID`). This test pins the *contract*; the polyfill below is what makes it hold on Hermes, where `randomUUID` is absent.

- [ ] **Step 3: Install the polyfill**

```bash
cd app && npx expo install react-native-get-random-values
```

- [ ] **Step 4: Import it first in `app/index.js`**

It must precede every other import — it patches `global.crypto` and anything that reads `crypto` while loading would capture the unpatched object.

```js
// Installs global.crypto.getRandomValues, which Hermes does not ship. Must be
// the first import in the app: `newId()` in @domain/items reads crypto at call
// time, but expo-crypto's randomUUID shim is installed during module load.
import 'react-native-get-random-values'
import 'react-native-gesture-handler'

import { registerRootComponent } from 'expo'
import App from './App'

registerRootComponent(App)
```

- [ ] **Step 5: Make `newId` use the polyfill's primitive**

`react-native-get-random-values` provides `getRandomValues`, not `randomUUID`. Update `src/domain/items.ts:27-31` so the fallback is a real v4 UUID built from it, rather than a 15-character string the server will reject:

```ts
/**
 * `crypto.randomUUID` exists on modern web; Hermes has only `getRandomValues`,
 * via react-native-get-random-values. The last fallback is not cryptographically
 * strong, but it is the right *shape* — and shape is what the server checks
 * before deciding whether to keep the client's id or mint its own.
 */
function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()

  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
```

This file is shared with the website; the change is strictly an improvement there too.

- [ ] **Step 6: Add a test that the fallback path also produces a valid shape**

```ts
test('the fallback id is still a shape the server accepts', async () => {
  const real = globalThis.crypto
  // @ts-expect-error — deliberately removing randomUUID to take the other branch
  globalThis.crypto = { getRandomValues: (a: Uint8Array) => real.getRandomValues(a) }
  try {
    expect(isUuid(createItem('Kettle').id)).toBe(true)
  } finally {
    globalThis.crypto = real
  }
})
```

- [ ] **Step 7: Run tests and drop `newListId`**

Remove `newListId` from `app/src/ids.ts` (the server mints list ids now). Keep `isListId`, `isSlug`, `isListRef`, `slugProblem` — the Name screen still validates before spending a request.

Run: `cd app && npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A app/ src/domain/items.ts
git commit -m "Generate real UUIDs on the phone

The server keeps a client-supplied item id only if it is 36 characters, and
mints its own otherwise. Hermes has no crypto.randomUUID, so the old fallback
produced a 15-character id, the server replaced it, and the optimistic row and
the stored row were different items. Harmless while nothing synced; fatal for a
queue that replays adds."
```

---

## Task 3: Make the server's addItem idempotent

**Files:**
- Modify: `server/db.js:189`
- Create: `vitest.config.js`, `server/db.test.js`
- Modify: root `package.json`

A replayed add whose first response was lost would otherwise hit the UNIQUE constraint, return 500, be classed as transient, and wedge that list's queue forever.

- [ ] **Step 1: Add Vitest at the root**

```bash
npm install -D vitest@^3
```

Add script `"test": "vitest run"`. Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['server/**/*.test.js'] } })
```

- [ ] **Step 2: Write the failing test** — `server/db.test.js`

```js
import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'thngstbuy-'))
  process.env.DB_FILE = join(dir, 'test.db')
  vi.resetModules()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('adding the same item id twice leaves one row', async () => {
  const db = await import('./db.js')
  await db.createList('abcdefghjkmn')
  const id = '11111111-1111-4111-8111-111111111111'

  await db.addItem('abcdefghjkmn', id, 'Kettle')
  await db.addItem('abcdefghjkmn', id, 'Kettle')

  const state = await db.readListById({ id: 'abcdefghjkmn', slug: 'abcdefghjkmn' })
  expect(state.items).toHaveLength(1)
})
```

Import `vi` from vitest alongside the others.

- [ ] **Step 3: Run it**

Run: `npm test`
Expected: FAIL — `UNIQUE constraint failed: items.id`.

- [ ] **Step 4: Add the conflict clause** — `server/db.js:189`

```js
  await adapter.execute(
    `INSERT INTO items (id, list_id, name, price, model, where_to, why, added_at, bought, bought_at, position)
     VALUES (?, ?, ?, NULL, '', '', '', ?, 0, NULL, ?)
     -- A queued add replayed after its response was lost must not fail. The
     -- client generates the id, so a collision means "already done", not a clash.
     ON CONFLICT(id) DO NOTHING`,
    [itemId, listId, name, now, num(rows[0].next)],
  )
```

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/db.test.js vitest.config.js package.json package-lock.json
git commit -m "Make addItem idempotent, so a replayed add cannot wedge a queue"
```

⚠️ **This needs a redeploy to take effect on `thngstbuy.vercel.app`.**

---

## Task 4: The networked API client

**Files:**
- Create: `app/src/config.ts`, `app/src/api.ts`, `app/src/api.test.ts`

**Interfaces produced:**

```ts
export class ApiError extends Error { constructor(readonly status: number, message: string) }
export const api: {
  createList(): Promise<ListState>
  getList(ref: string): Promise<ListState>
  getVersion(ref: string): Promise<{ version: number }>
  renameList(ref: string, slug: string): Promise<ListState>
  addItem(ref: string, item: { id: string; name: string }): Promise<ListState>
  patchItem(ref: string, itemId: string, patch: Partial<Item>): Promise<ListState>
  removeItem(ref: string, itemId: string): Promise<ListState>
}
```

- [ ] **Step 1: Write the failing test** — `app/src/api.test.ts`

```ts
import { expect, test, vi } from 'vitest'
import { ApiError, api } from './api'
import { API_BASE } from './config'

function stub(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch
}

test('a list is fetched from the configured host', async () => {
  const fetchStub = stub(200, { slug: 'shaxzod', version: 1, items: [] })
  globalThis.fetch = fetchStub

  const state = await api.getList('shaxzod')
  expect(state.slug).toBe('shaxzod')
  expect((fetchStub as any).mock.calls[0][0]).toBe(`${API_BASE}/api/lists/shaxzod`)
})

test('a failure carries the status and the server message', async () => {
  globalThis.fetch = stub(404, { error: 'no such list' })
  await expect(api.getList('gone')).rejects.toMatchObject({
    status: 404,
    message: 'no such list',
  })
  await expect(api.getList('gone')).rejects.toBeInstanceOf(ApiError)
})

test('a patch sends only the fields it was given', async () => {
  const fetchStub = stub(200, { slug: 's', version: 2, items: [] })
  globalThis.fetch = fetchStub

  await api.patchItem('s', 'item-1', { why: 'because' })
  const init = (fetchStub as any).mock.calls[0][1]
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body)).toEqual({ why: 'because' })
})
```

- [ ] **Step 2: Run it** — Expected: FAIL, modules missing.

- [ ] **Step 3: Write `app/src/config.ts`**

```ts
/**
 * Where the list lives. The phone has no relative URL to fall back on, so this
 * is the one piece of deployment knowledge the app carries.
 *
 * In development, point it at a machine on the same network — `npm run dev:api`
 * on the repo root serves this on 8787. Android blocks cleartext HTTP in
 * release builds, which is why the override is debug-only.
 */
export const API_BASE = __DEV__
  ? (process.env.EXPO_PUBLIC_API_BASE ?? 'https://thngstbuy.vercel.app')
  : 'https://thngstbuy.vercel.app'

/** The link handed to someone else. */
export const shareUrl = (slug: string) => `https://thngstbuy.vercel.app/l/${slug}`
```

- [ ] **Step 4: Write `app/src/api.ts`**

A port of the web app's `src/data/api.ts` (which stays as it is) with three changes: an absolute base URL, a timeout, and `ListState` re-exported for the mirror.

```ts
import type { Item } from '@domain/types'
import { API_BASE } from './config'

export type ListState = { slug: string; version: number; items: Item[] }

/** Identifies this device so the server can attribute a write. */
export const clientId = Math.random().toString(36).slice(2) + Date.now().toString(36)

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/**
 * A phone loses signal mid-request far more often than a browser does, and
 * without this the promise can hang until the OS gives up minutes later — long
 * enough for the syncer to look wedged.
 */
const TIMEOUT_MS = 15_000

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId, ...init?.headers },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`)
    }

    return res.json() as Promise<T>
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  createList: () => request<ListState>('/lists', { method: 'POST' }),
  getList: (ref: string) => request<ListState>(`/lists/${ref}`),
  getVersion: (ref: string) => request<{ version: number }>(`/lists/${ref}/version`),
  renameList: (ref: string, slug: string) =>
    request<ListState>(`/lists/${ref}`, { method: 'PATCH', body: JSON.stringify({ slug }) }),
  addItem: (ref: string, item: { id: string; name: string }) =>
    request<ListState>(`/lists/${ref}/items`, { method: 'POST', body: JSON.stringify(item) }),
  patchItem: (ref: string, itemId: string, patch: Partial<Item>) =>
    request<ListState>(`/lists/${ref}/items/${itemId}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),
  removeItem: (ref: string, itemId: string) =>
    request<ListState>(`/lists/${ref}/items/${itemId}`, { method: 'DELETE' }),
}
```

Add `declare const __DEV__: boolean` to `app/src/config.ts` guarded for the test environment, or set `define: { __DEV__: true }` in `vitest.config.ts`. Use the latter.

- [ ] **Step 5: Run tests** — Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add app/src/api.ts app/src/config.ts app/src/api.test.ts app/vitest.config.ts
git commit -m "Add the networked list client the phone lost"
```

---

## Task 5: The outbox

**Files:**
- Create: `app/src/outbox.ts`, `app/src/outbox.test.ts`

**Interfaces produced:**

```ts
export type OpKind = 'addItem' | 'patchItem' | 'removeItem'
export type Op = {
  seq: number
  listId: string
  kind: OpKind
  itemId: string | null
  payload: Record<string, unknown>
}
export const outbox: {
  append(listId: string, kind: OpKind, itemId: string | null, payload: Record<string, unknown>): Promise<void>
  peek(listId: string): Promise<Op[]>
  drop(seq: number): Promise<void>
  count(listId: string): Promise<number>
}
```

- [ ] **Step 1: Write the failing test** — `app/src/outbox.test.ts`

```ts
import { beforeEach, expect, test } from 'vitest'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { outbox } from './outbox'

beforeEach(() => useAdapter(() => createNodeAdapter(':memory:')))

test('ops come back in the order they were appended', async () => {
  await outbox.append('l1', 'addItem', 'i1', { id: 'i1', name: 'Kettle' })
  await outbox.append('l1', 'patchItem', 'i1', { price: 200000 })
  await outbox.append('l1', 'removeItem', 'i1', {})

  expect((await outbox.peek('l1')).map((o) => o.kind))
    .toEqual(['addItem', 'patchItem', 'removeItem'])
})

test('ops are scoped to their list', async () => {
  await outbox.append('l1', 'addItem', 'i1', { id: 'i1', name: 'A' })
  await outbox.append('l2', 'addItem', 'i2', { id: 'i2', name: 'B' })

  expect(await outbox.count('l1')).toBe(1)
  expect((await outbox.peek('l2')).map((o) => o.itemId)).toEqual(['i2'])
})

test('dropping removes exactly one op', async () => {
  await outbox.append('l1', 'addItem', 'i1', { id: 'i1', name: 'A' })
  await outbox.append('l1', 'addItem', 'i2', { id: 'i2', name: 'B' })

  const [first] = await outbox.peek('l1')
  await outbox.drop(first.seq)

  expect((await outbox.peek('l1')).map((o) => o.itemId)).toEqual(['i2'])
})

test('the payload survives a round trip', async () => {
  await outbox.append('l1', 'patchItem', 'i1', { why: 'because', price: null })
  expect((await outbox.peek('l1'))[0].payload).toEqual({ why: 'because', price: null })
})
```

- [ ] **Step 2: Run it** — Expected: FAIL, module missing.

- [ ] **Step 3: Write `app/src/outbox.ts`**

```ts
/**
 * Writes that have not reached the server yet, in the order they were made.
 *
 * Order is the whole point. The server applies field-level patches, so replaying
 * these in sequence reproduces what the user did; replaying them out of order
 * would let an older value win. `seq` is an AUTOINCREMENT so it is monotonic
 * even across the row deletions that draining causes.
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
  async append(listId: string, kind: OpKind, itemId: string | null, payload: Record<string, unknown>) {
    const adapter = await getAdapter()
    await adapter.execute(
      `INSERT INTO outbox (list_id, kind, item_id, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      [listId, kind, itemId, JSON.stringify(payload), new Date().toISOString()],
    )
  },

  async peek(listId: string): Promise<Op[]> {
    const adapter = await getAdapter()
    const { rows } = await adapter.execute(
      `SELECT seq, list_id, kind, item_id, payload FROM outbox WHERE list_id = ? ORDER BY seq`,
      [listId],
    )
    return (rows as OpRow[]).map(toOp)
  },

  async drop(seq: number) {
    const adapter = await getAdapter()
    await adapter.execute(`DELETE FROM outbox WHERE seq = ?`, [seq])
  },

  async count(listId: string): Promise<number> {
    const adapter = await getAdapter()
    const { rows } = await adapter.execute(
      `SELECT COUNT(*) AS n FROM outbox WHERE list_id = ?`, [listId],
    )
    return Number((rows[0] as { n: number }).n)
  },
}
```

- [ ] **Step 4: Run tests** — Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/outbox.ts app/src/outbox.test.ts
git commit -m "Add the outbox: writes that have not reached the server yet"
```

---

## Task 6: The sync engine

The heart of the change. Everything else is plumbing.

**Files:**
- Create: `app/src/sync.ts`, `app/src/sync.test.ts`

**Interfaces produced:**

```ts
export type SyncState = { live: boolean; pending: number }
export type SyncDeps = { api: typeof import('./api').api; now?: () => number }
export function createSyncer(listId: string, deps?: Partial<SyncDeps>): Syncer
export type Syncer = {
  /** Applies a write locally, queues it, and kicks the drain. */
  enqueue(kind: OpKind, itemId: string | null, payload: Record<string, unknown>): Promise<void>
  /** One full cycle: drain, then pull. Resolves when it settles. */
  cycle(): Promise<void>
  state(): SyncState
  subscribe(fn: (state: SyncState) => void): () => void
  onChange(fn: () => void): () => void
}
export const BACKOFF_MS: readonly number[]
```

- [ ] **Step 1: Write the failing tests** — `app/src/sync.test.ts`

```ts
import { beforeEach, expect, test, vi } from 'vitest'
import { useAdapter } from './sqlite'
import { createNodeAdapter } from './testing/nodeAdapter'
import { mirror } from './mirror'
import { outbox } from './outbox'
import { createSyncer } from './sync'
import { ApiError, type ListState } from './api'

const ITEM = {
  price: null, model: '', where: '', why: '',
  addedAt: '2026-08-07T00:00:00.000Z', bought: false, boughtAt: null,
}
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** A stand-in server that records calls and can be told to fail. */
function fakeApi(state: ListState) {
  const calls: string[] = []
  return {
    calls,
    state,
    getVersion: vi.fn(async () => ({ version: state.version })),
    getList: vi.fn(async () => state),
    addItem: vi.fn(async (_ref: string, item: { id: string; name: string }) => {
      calls.push(`add:${item.id}`)
      state = { ...state, version: state.version + 1,
        items: [...state.items, { id: item.id, name: item.name, ...ITEM }] }
      return state
    }),
    patchItem: vi.fn(async (_ref: string, itemId: string, patch: object) => {
      calls.push(`patch:${itemId}`)
      state = { ...state, version: state.version + 1,
        items: state.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }
      return state
    }),
    removeItem: vi.fn(async (_ref: string, itemId: string) => {
      calls.push(`remove:${itemId}`)
      state = { ...state, version: state.version + 1,
        items: state.items.filter((i) => i.id !== itemId) }
      return state
    }),
    createList: vi.fn(), renameList: vi.fn(),
  }
}

beforeEach(async () => {
  useAdapter(() => createNodeAdapter(':memory:'))
  await mirror.adopt({ slug: 'shaxzod', version: 0, items: [] })
})

test('a queued write reaches the server and leaves the outbox', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${A}`])
  expect(await outbox.count('shaxzod')).toBe(0)
  expect(syncer.state().pending).toBe(0)
})

test('ops replay in the order they were made', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.enqueue('patchItem', A, { price: 200000 })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${A}`, `patch:${A}`, `add:${B}`])
})

test('a 404 on patch drops the op — delete beats edit', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  server.patchItem = vi.fn(async () => { throw new ApiError(404, 'no such item') })
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('patchItem', A, { why: 'because' })
  await syncer.cycle()

  expect(await outbox.count('shaxzod')).toBe(0)
})

test('a network failure keeps the op and reports not-live', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  server.addItem = vi.fn(async () => { throw new TypeError('Network request failed') })
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.cycle()

  expect(await outbox.count('shaxzod')).toBe(1)
  expect(syncer.state().live).toBe(false)
  expect(syncer.state().pending).toBe(1)
})

test('draining stops at the first transient failure, so order holds', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  server.addItem = vi.fn(async () => { throw new TypeError('Network request failed') })
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('addItem', A, { id: A, name: 'Kettle' })
  await syncer.enqueue('patchItem', A, { price: 1 })
  await syncer.cycle()

  expect(server.patchItem).not.toHaveBeenCalled()
  expect(await outbox.count('shaxzod')).toBe(2)
})

test('a 400 drops the op rather than blocking the queue behind it', async () => {
  const server = fakeApi({ slug: 'shaxzod', version: 0, items: [] })
  const realAdd = server.addItem
  server.addItem = vi.fn(async (ref: string, item: any) => {
    if (item.id === A) throw new ApiError(400, 'name is required')
    return realAdd(ref, item)
  }) as any
  const syncer = createSyncer('shaxzod', { api: server as any })

  await syncer.enqueue('addItem', A, { id: A, name: '' })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()

  expect(server.calls).toEqual([`add:${B}`])
  expect(await outbox.count('shaxzod')).toBe(0)
})

test('a pulled snapshot does not erase an unsent edit', async () => {
  // The server knows about Kettle. Offline, we rename it and add Lamp.
  const server = fakeApi({
    slug: 'shaxzod', version: 5, items: [{ id: A, name: 'Kettle', ...ITEM }],
  })
  server.addItem = vi.fn(async () => { throw new TypeError('offline') })
  server.patchItem = vi.fn(async () => { throw new TypeError('offline') })

  const syncer = createSyncer('shaxzod', { api: server as any })
  await syncer.enqueue('patchItem', A, { name: 'Electric kettle' })
  await syncer.enqueue('addItem', B, { id: B, name: 'Lamp' })
  await syncer.cycle()

  const state = await mirror.getList('shaxzod')
  expect(state.items.map((i) => i.name)).toEqual(['Electric kettle', 'Lamp'])
})
```

- [ ] **Step 2: Run** — Expected: FAIL, `./sync` missing.

- [ ] **Step 3: Write `app/src/sync.ts`**

```ts
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
 * What *is* needed is care in two places:
 *
 *  1. Draining stops at the first transient failure. Skipping a stuck op and
 *     sending the next one would let an older value overwrite a newer one.
 *  2. A snapshot pulled while ops are still queued is rebased, not adopted —
 *     the snapshot goes into the mirror and the pending ops are re-applied on
 *     top. Without this an unsent edit visibly reverts, which reads as data loss
 *     even though it would come back a moment later.
 */
import { ApiError, api as realApi, type ListState } from './api'
import { mirror } from './mirror'
import { type Op, type OpKind, outbox } from './outbox'

export type SyncState = { live: boolean; pending: number }

export const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000] as const

type Deps = { api: typeof realApi }

export function createSyncer(listId: string, deps: Partial<Deps> = {}) {
  const api = deps.api ?? realApi

  let state: SyncState = { live: true, pending: 0 }
  const watchers = new Set<(s: SyncState) => void>()
  const changed = new Set<() => void>()

  function publish(next: Partial<SyncState>) {
    state = { ...state, ...next }
    for (const watcher of watchers) watcher(state)
  }

  const announce = () => {
    for (const fn of changed) fn()
  }

  /** Sends one op. Returns whether the queue may keep going. */
  async function send(op: Op): Promise<'done' | 'drop' | 'stop'> {
    try {
      const result = await run(op)
      await mirror.adopt(result)
      return 'done'
    } catch (failure) {
      if (failure instanceof ApiError) {
        // The item is gone upstream, or the server refused the value outright.
        // Either way, retrying can only fail the same way for ever.
        if (failure.status === 404 || failure.status === 400 || failure.status === 409) {
          return 'drop'
        }
      }
      return 'stop'
    }
  }

  function run(op: Op): Promise<ListState> {
    switch (op.kind) {
      case 'addItem':
        return api.addItem(listId, op.payload as { id: string; name: string })
      case 'patchItem':
        return api.patchItem(listId, op.itemId!, op.payload)
      case 'removeItem':
        return api.removeItem(listId, op.itemId!)
    }
  }

  /** Re-applies queued ops on top of whatever the mirror now holds. */
  async function rebase(pending: Op[]) {
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
        // The op no longer applies to this snapshot — e.g. a patch for something
        // the server deleted. Its turn on the wire will decide its fate.
      }
    }
  }

  async function drain(): Promise<boolean> {
    for (const op of await outbox.peek(listId)) {
      const outcome = await send(op)
      if (outcome === 'stop') {
        publish({ live: false, pending: await outbox.count(listId) })
        return false
      }
      await outbox.drop(op.seq)
    }
    publish({ live: true, pending: 0 })
    return true
  }

  async function pull() {
    const { version } = await api.getVersion(listId)
    const local = await mirror.lastVersion(listId)
    if (version === local) return
    await mirror.adopt(await api.getList(listId))
  }

  return {
    async enqueue(kind: OpKind, itemId: string | null, payload: Record<string, unknown>) {
      await outbox.append(listId, kind, itemId, payload)
      publish({ pending: await outbox.count(listId) })
    },

    async cycle() {
      const drained = await drain()

      try {
        if (drained) {
          await pull()
          publish({ live: true })
        } else {
          // Still offline, but the mirror may hold a snapshot from before the
          // ops were queued. Re-apply them so the screen shows the user's work.
          await rebase(await outbox.peek(listId))
        }
      } catch {
        publish({ live: false })
      }

      announce()
    },

    state: () => state,

    subscribe(fn: (s: SyncState) => void) {
      watchers.add(fn)
      return () => void watchers.delete(fn)
    },

    onChange(fn: () => void) {
      changed.add(fn)
      return () => void changed.delete(fn)
    },
  }
}

export type Syncer = ReturnType<typeof createSyncer>
```

- [ ] **Step 4: Add `mirror.lastVersion`**

```ts
/** The server version this device last adopted. -1 when it has never synced. */
async lastVersion(ref: string): Promise<number> {
  const adapter = await getAdapter()
  const { rows } = await adapter.execute(
    `SELECT last_version FROM sync_meta WHERE list_id = (
       SELECT id FROM lists WHERE slug = ? OR id = ? LIMIT 1)`,
    [ref, ref],
  )
  return rows.length === 0 ? -1 : Number((rows[0] as { last_version: number }).last_version)
}
```

- [ ] **Step 5: Run tests**

Run: `cd app && npm test src/sync.test.ts`
Expected: PASS, 7 tests. If the rebase test fails because `mirror.addItem` rejects a duplicate, add `ON CONFLICT(id) DO NOTHING` to `mirror.addItem`'s INSERT for the same reason the server needed it.

- [ ] **Step 6: Commit**

```bash
git add app/src/sync.ts app/src/sync.test.ts app/src/mirror.ts
git commit -m "Add the sync engine: drain in order, rebase rather than clobber

Replaying field-level patches against client-generated ids IS the merge, so
there is no protocol here -- only the two rules that keep it honest. Draining
stops at the first transient failure, because skipping a stuck op would let an
older value overwrite a newer one. And a snapshot arriving while ops are still
queued is rebased rather than adopted, because an unsent edit blinking out and
returning reads as data loss."
```

---

## Task 7: Rewire `useSyncedList`

**Files:**
- Modify: `app/src/useSyncedList.ts`

**Interfaces produced:** `SyncedList` gains `live: boolean` and `pending: number`; `rename` becomes online-only.

- [ ] **Step 1: Replace every `store.*` call with `syncer.enqueue` + a mirror write**

Each mutation does two things in the order the spec sets out: apply to the mirror, append to the outbox. The existing optimistic `setItems` and the per-item debounce stay exactly as they are — they are about the screen, not about the network.

```ts
const syncer = useMemo(() => (listId ? createSyncer(listId) : null), [listId])

// add
const item = Items.createItem(trimmed)
setItems((prev) => [...prev, item])
void (async () => {
  await mirror.addItem(listId, { id: item.id, name: item.name })
  await syncer!.enqueue('addItem', item.id, { id: item.id, name: item.name })
  void syncer!.cycle()
})()
```

`patchItem` and `removeItem` follow the same shape. Delete `write()` and the `inFlight`/`stale` refs — the outbox now holds what they were approximating.

- [ ] **Step 2: Poll while foregrounded**

```ts
useEffect(() => {
  if (!syncer || status !== 'ready') return
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped || AppState.currentState !== 'active') return
    await syncer.cycle()
  }

  const loop = () => {
    timer = setTimeout(async () => {
      await tick()
      if (!stopped) loop()
    }, 3000)
  }

  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') void tick()
    else flushAll()
  })

  void tick()
  loop()
  return () => {
    stopped = true
    clearTimeout(timer)
    sub.remove()
  }
}, [syncer, status, flushAll])
```

- [ ] **Step 3: Surface `live` and `pending`**

```ts
const [sync, setSync] = useState<SyncState>({ live: true, pending: 0 })
useEffect(() => syncer?.subscribe(setSync), [syncer])
useEffect(() => syncer?.onChange(() => void reload()), [syncer, reload])
```

where `reload` re-reads the mirror into `items`. Return `live: sync.live` and `pending: sync.pending`.

- [ ] **Step 4: Make rename online-only**

```ts
const rename = useCallback(async (next: string): Promise<string | null> => {
  if (!listId) return 'Not ready yet.'
  const shape = slugProblem(next)
  if (shape) return shape
  try {
    await mirror.adopt(await api.renameList(listId, next))
    await reload()
    return null
  } catch (failure) {
    if (failure instanceof ApiError) return failure.message
    return 'Renaming needs a connection.'
  }
}, [listId, reload])
```

- [ ] **Step 5: Typecheck and test**

Run: `cd app && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/useSyncedList.ts
git commit -m "Put the list hook on the sync engine"
```

---

## Task 8: The screens

**Files:**
- Modify: `app/App.tsx`, `app/src/ListScreen.tsx`, `app/src/NameScreen.tsx`

- [ ] **Step 1: Online-only list creation in `App.tsx`**

`store.createList()` becomes `api.createList()`. When it fails there is no list to show, so the existing `Notice` gains a case:

```tsx
<Notice
  title="No connection"
  body="Starting a new list needs the internet, because the list lives on the server so it can be shared. Open an existing link, or try again once you're online."
  actionLabel="Try again"
  onPress={startFresh}
/>
```

- [ ] **Step 2: Share in `ListScreen.tsx`**

Header gains Share beside Name.

```tsx
import { Share } from 'react-native'
import { shareUrl } from './config'

const onShare = () => {
  if (!slug) return
  void Share.share({ message: shareUrl(slug) })
}
```

```tsx
<View style={styles.headerActions}>
  <Pressable onPress={onShare} hitSlop={10} accessibilityRole="button">
    <Text style={styles.share}>Share</Text>
  </Pressable>
  <Pressable onPress={onRename} hitSlop={10} accessibilityRole="button">
    <Text style={styles.share}>Name</Text>
  </Pressable>
</View>
```

with `headerActions: { flexDirection: 'row', gap: 18 }`.

- [ ] **Step 3: The sync marker**

Quiet, in the existing muted ink — no spinner, no badge.

```tsx
{(!live || pending > 0) && (
  <Text style={styles.syncNote}>
    {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} to send` : 'Offline'}
  </Text>
)}
```

```ts
syncNote: { fontFamily: font.regular, fontSize: 12, color: color.inkMuted, marginTop: 2 },
```

- [ ] **Step 4: Offline notice on `NameScreen`**

The rename call already returns a message; render it in the existing error slot. No new state.

- [ ] **Step 5: Typecheck, test, bundle**

Run: `cd app && npx tsc --noEmit && npm test && npx expo export --platform android --output-dir /tmp/export-check`
Expected: all pass; the bundle builds.

- [ ] **Step 6: Commit**

```bash
git add app/App.tsx app/src/ListScreen.tsx app/src/NameScreen.tsx
git commit -m "Bring Share back, and say when there is something still to send"
```

---

## Task 9: Deep links and the manifest

**Files:**
- Modify: `app/app.json`

`app/android/` is generated and gitignored, so the intent filter goes in `app.json` and `expo prebuild` writes it out.

- [ ] **Step 1: Add the https intent filter**

```json
"android": {
  "package": "app.thngstbuy.client",
  "adaptiveIcon": { "backgroundColor": "#FAF9F6" },
  "intentFilters": [
    {
      "action": "VIEW",
      "autoVerify": true,
      "data": [{ "scheme": "https", "host": "thngstbuy.vercel.app", "pathPrefix": "/l" }],
      "category": ["BROWSABLE", "DEFAULT"]
    }
  ]
}
```

`App.tsx`'s `listFromUrl` regex already matches both `thngstbuy://l/x` and `https://thngstbuy.vercel.app/l/x`; no code change.

- [ ] **Step 2: Regenerate and verify**

Run: `cd app && npx expo prebuild --platform android --clean`
Then confirm the filter is present in `app/android/app/src/main/AndroidManifest.xml`.

- [ ] **Step 3: Commit**

```bash
git add app/app.json
git commit -m "Open a shared link in the app when it is installed"
```

---

## Task 10: Documentation

**Files:**
- Modify: `README.md`, `app/README.md`, the spec's status line

- [ ] **Step 1: Rewrite the main README's phone sections**

`## The phone app` currently opens "it is **not** a client for the server above" and says it "makes no network calls at all". Both are now false. Rewrite to describe the mirror-plus-outbox design, and delete the paragraph suggesting `android.permission.INTERNET` be stripped — it is required now.

Port notes 1 and 3 are overtaken in the other direction; replace the list with a short note pointing at the spec.

- [ ] **Step 2: Rewrite `app/README.md`'s "What it can't do"**

Sharing, sync and multi-device all now work. What remains true: no accounts, and anyone with the link can edit. Add that the app works offline and syncs when it reconnects, and state the conflict rules in one line each.

- [ ] **Step 3: Mark the spec implemented**

Change the spec's `**Status:**` line to `implemented 2026-08-07`.

- [ ] **Step 4: Commit**

```bash
git add README.md app/README.md docs/
git commit -m "Update the docs to describe an app that syncs again"
```

---

## Self-Review

**Spec coverage.** Architecture → Tasks 1, 4, 5, 6. Data model → Task 1 (schema). Write path → Task 7. Sync loop, drain table, backoff, rebase → Task 6. Conflict rules → Task 6 tests, plus online-only rename/create in Tasks 7 and 8. The two prerequisite fixes → Tasks 2 and 3. Status surface → Tasks 7 and 8. Share → Task 8. Config → Task 4. EAS → already committed in `e75a5a1`. Testing → Task 1 establishes the harness the spec assumed existed. README → Task 10.

**Deviation from the spec, deliberate:** the spec said tests would run "against real `expo-sqlite`". They cannot — it is a native module with no Node build. Task 1 introduces the adapter seam so the same SQL runs under `node:sqlite` instead, which is the pattern `server/adapters.js` already uses. The statements under test are the statements the app runs.

**Deviation, second:** `BACKOFF_MS` is exported and tested as a constant, but the timer that consumes it lives in `useSyncedList`'s poll loop (Task 7) rather than inside `createSyncer`. Keeping `cycle()` synchronous-to-completion is what makes the engine testable without fake timers; the retry cadence is a screen concern.

**Type consistency.** `ListState` is defined once in `api.ts` and imported by `mirror.ts` and `sync.ts`. `mirror` (not `store`) is the export name from Task 1 onward. `OpKind` values match the `run()` switch and the `rebase()` switch. `mirror.lastVersion` is introduced in Task 6 Step 4 and used only there.

**Known gap, stated rather than hidden:** no test drives `useSyncedList` or the screens — that needs `@testing-library/react-native`, which is a dependency and a harness this plan does not add. The hook is covered indirectly through `sync.ts`, and the screens are covered by typecheck plus the bundle. Device verification remains the real gate, as the README already says.
