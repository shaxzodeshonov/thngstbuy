# Offline-first phone app, synced to the server

**Date:** 2026-08-07
**Status:** implemented 2026-08-07
**Scope:** `app/`, one line of `server/db.js`, the phone sections of `README.md`

## What this changes

`app/` is today a standalone Expo app: its own SQLite database, no network calls,
works in aeroplane mode, and nothing syncs between it and the website. That was a
deliberate fork, recorded in the README — the website's premise is that the URL is
the credential, and the app's premise was "the same list, on me, with no account
and no connection."

This spec reverses the sharing half of that decision while keeping the offline
half. After this change the phone app is a full peer of the website: a
`/l/shaxzod` link opens the same list on both, edits made on either show up on
the other, and the app still works with the network off — writes queue on the
device and replay when it comes back.

The two halves of the old trade-off are both kept. What it costs is a sync
engine, and the honest limits on it are written down under
[Conflict rules](#conflict-rules).

## Why an op log rather than a merge

The server's write API turns out to be shaped for this already:

- `PATCH /lists/:id/items/:itemId` is a **field-level** patch — only the keys
  present in the body are written (`server/db.js:198`). Two clients editing
  different fields of the same item do not overwrite each other.
- `POST /lists/:id/items` takes a **client-generated id** (`server/app.js:170`),
  so an optimistic row and the stored row are the same row.

That means a queue of deferred API calls, replayed in order, *is* the merge. The
resulting semantics are field-level last-write-wins by arrival order — which is
exactly what the website already gets between two live editors. No version
vectors, no CRDT, no merge protocol invented for this.

The work is therefore not "design conflict resolution." It is "make replay
idempotent, and never let a pulled snapshot erase an unsent edit."

## Architecture

```
UI  (ListScreen · DetailScreen · NameScreen · ShareSheet)
 │
useSyncedList     optimistic UI + per-item debounce  (rules unchanged)
 │
sync.ts           drain · pull · rebase · connection state
 ├── outbox.ts    durable op log (SQLite table)
 ├── mirror.ts    local replica of the list  (today's localStore, renamed)
 └── api.ts       networked client (port of the web app's src/data/api.ts)
```

Each unit, and what it depends on:

| Unit | Does | Depends on |
| --- | --- | --- |
| `api.ts` | One method per endpoint, absolute base URL, throws `ApiError` | `config.ts` |
| `mirror.ts` | Local replica; same eight methods `localStore.ts` has now | `expo-sqlite` |
| `outbox.ts` | Append / peek / drop ops, durably and in order | `expo-sqlite` |
| `sync.ts` | Drains outbox, pulls snapshots, rebases, reports connection | all three above |
| `useSyncedList.ts` | Optimistic state + debounce for the UI | `sync.ts`, `mirror.ts` |

`mirror.ts` is `localStore.ts` renamed, not rewritten. Its schema is already a
transcription of `server/db.js`, which is precisely what a mirror needs to be.
The rename is so the name stops claiming it is the source of truth.

`app/src/ids.ts` loses `newListId` — the server mints list ids now — and keeps
`slugProblem`, which still earns its place validating a name in the Name screen
before a request is spent on it.

## Data model

Existing `lists` and `items` tables stay as they are — they become the mirror of
server state rather than the truth.

Two additions:

```sql
CREATE TABLE IF NOT EXISTS outbox (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,      -- 'addItem' | 'patchItem' | 'removeItem'
  item_id    TEXT,
  payload    TEXT NOT NULL,      -- JSON
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_meta (
  list_id      TEXT PRIMARY KEY,
  last_version INTEGER NOT NULL  -- last server version adopted
);
```

`seq` is the ordering. Replay is strictly oldest-first, per list.

## The write path

Identical whether or not there is a connection:

1. Apply to the mirror.
2. Append the op to the outbox.

   Steps 1 and 2 are one SQLite transaction. A crash between them would either
   lose an edit the user saw, or send one the mirror never applied.
3. Kick the syncer (non-blocking).

The UI reads only from the mirror, so it paints immediately and never waits on
the network.

## The sync loop

**Triggers:** app foreground (`AppState` → `active`), an outbox append, a poll
tick, or a backoff timer.

**Drain.** Replay ops oldest-first. On a 2xx, delete the op and adopt the
returned state into the mirror. On failure:

| Response | Meaning | Action |
| --- | --- | --- |
| 404 on patch/remove | item deleted upstream | drop the op — **delete beats edit** |
| 404 on the list itself | list is gone | stop; surface `missing` to the UI |
| 400 / 409 on add | validation, or the 500-item cap | drop the op, surface one line |
| 5xx / network error | transient | stop draining, back off, retry |

Rename does not appear here because it never enters the outbox — see
[Conflict rules](#conflict-rules).

Backoff: 1s → 2s → 5s → 15s → 30s, capped. Reset on any success or on
foreground.

Ops for one list are drained strictly in order and draining stops at the first
transient failure, so a later op can never land before an earlier one.

**Pull.** Once the outbox for a list is empty, `getVersion`. If it differs from
`sync_meta.last_version`, `getList` and adopt into the mirror. Poll every 3s
while the app is foregrounded — matching the website, and for the same stated
reason: the backend is serverless, so there is nowhere to hold a subscriber list
and push. Backgrounded, polling stops entirely.

**Rebase.** If a snapshot arrives while ops are still pending — a pull that
raced a write, or a drain that failed partway — adopt the snapshot into the
mirror and then re-apply every pending op on top, locally. Without this, an
unsent edit visibly reverts and then comes back, which reads as data loss.

## Conflict rules

Stated plainly, because these are the cases where a user can lose a keystroke:

- **Field-level last-write-wins, by arrival order.** Edit a price offline while
  someone else edits the same price online, and whoever's write reaches the
  server second wins. Different fields of the same item both survive.
- **Delete beats a concurrent edit.** Editing an item someone else deleted drops
  your edit rather than resurrecting the item.
- **Adds never collide.** Client-generated UUIDs.
- **Rename is online-only.** "Is this name free?" cannot be answered offline, and
  an optimistic rename that later loses would change a URL that had already been
  handed to someone.
- **Creating a list is online-only.** `POST /lists` mints the id.

The two online-only actions show a plain "needs a connection" state. They are not
queued, and they do not fail obscurely.

## Two fixes this depends on

Both are prerequisites, not nice-to-haves. Without either, offline replay is
actively wrong rather than merely absent.

**1. `addItem` must be idempotent** — `server/db.js:189`

```sql
INSERT INTO items (...) VALUES (...) ON CONFLICT(id) DO NOTHING
```

Today it is a bare `INSERT`. An add that succeeded on the server but whose
response was lost (dropped connection, backgrounded app) would fail the
UNIQUE constraint on retry, return 500, and — because 5xx is treated as
transient — wedge that list's queue permanently. Harmless for the web client,
which never retries an add. **Requires a redeploy to take effect.**

**2. Real UUIDs on the device** — `react-native-get-random-values`

`newId()` (`src/domain/items.ts:30`) falls back to a 15-character id when
`crypto.randomUUID` is missing, and Hermes has no `randomUUID`. The server's
`isUuid` check (`server/app.js:283`) requires exactly 36 characters, so it would
reject the client's id and **mint its own**. The optimistic row and the stored
row would then be different items, and every replayed add would duplicate.

Add the dependency and import the polyfill at the top of `app/index.js`, above
the gesture-handler import. The README already flagged this (port note 5); it has
been latent only because the app made no network calls.

## Status surface

`useSyncedList` gains two fields:

- `live: boolean` — false when the last attempt failed.
- `pending: number` — ops waiting in the outbox.

The list header shows a quiet marker when `pending > 0` or `!live` — text and a
hairline, in the existing muted ink, consistent with the app's restraint. No
per-row spinners and no blocking modals: the point of offline-first is that the
user does not have to care.

## Share

The header regains **Share** alongside **Name**, since links mean something
again. `Share.share()` from React Native with
`https://thngstbuy.vercel.app/l/<slug>`.

The Android manifest gains an intent filter for the https host, so the link opens
the app when installed and the browser when not. The existing
`thngstbuy://l/<slug>` scheme keeps working; `App.tsx`'s `listFromUrl` regex
already matches both shapes.

## Configuration

`app/src/config.ts`:

```ts
export const API_BASE = 'https://thngstbuy.vercel.app'
```

with a development override so the app can be pointed at `http://<LAN-ip>:8787`
during work. Android blocks cleartext HTTP by default, so the LAN override needs
a debug-only manifest allowance — debug-only, so the release build keeps the
guarantee.

`android.permission.INTERNET` is now genuinely required. The README paragraph
suggesting it be stripped from the release manifest must go.

## Installable build

`app/eas.json`:

- `preview` — `buildType: apk`, the profile that produces a file that can be
  sideloaded onto a phone.
- `production` — `app-bundle`, for the Play Store, if it is ever wanted.

Build command:

```bash
cd app && npx eas-cli build --platform android --profile preview
```

This requires an interactive login to a free Expo account. **The user runs this**
— credentials are not something to hand over. EAS returns a download URL; opening
it on the phone installs the APK after allowing an unknown source.

## Testing

- **`mirror.ts` and `outbox.ts`** — against real `expo-sqlite`, as
  `localStore.ts`'s statements already have been. Transaction atomicity of the
  write path is the one that matters most.
- **Replay and rebase** — table-driven against a real `server/index.js` on
  `:8787`, covering: offline edits then replay; delete-vs-edit; a duplicate add
  after a lost response; the 500-item cap; a taken name; and a snapshot landing
  mid-drain.
- **Backoff** — with a fake timer, asserting the schedule and the reset.
- **On a device** — the README's "Not verified on a device" section still stands
  and grows: swipe feel, keyboard behaviour, first-launch database creation, and
  now aeroplane-mode edit → reconnect → appears on the website.

## README

The phone-app sections (`## The phone app`, `### What is shared, and what
isn't`, and the port notes) describe the architecture this spec reverses. They
are rewritten rather than patched — including removing the "makes no network
calls at all" claim, the INTERNET-permission suggestion, and port notes 1 and 3,
which this change overtakes in the other direction.

## Out of scope

- Push notifications. Polling matches the website and the serverless constraint.
- Accounts or auth. The URL remains the only credential.
- iOS. `app.json` already carries a bundle identifier; nothing here blocks it,
  but it is not built or tested.
- Merging two lists, or moving an existing local-only list onto the server.
  Anyone with data in the current build starts fresh.
