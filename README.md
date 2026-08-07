# thngstbuy

A quiet, shared list of things you're thinking about buying. Each item holds a
price and three notes — which model, where, and why — so the list argues with you
a little before you spend.

Open it, get a link, send the link. Whoever has it can read and write.

```bash
npm install
npm run dev
```

http://localhost:5173 — this runs two processes: the API on `8787` and Vite on
`5173`, which proxies `/api` to it. Local development needs no account and no
network: it stores everything in `data/thngstbuy.db` via Node's built-in SQLite.

**To put it online, see [Deploying](#deploying).**

---

## How sharing works

There are no accounts and no login. **The URL is the credential.**

- Landing on `/` mints a list and replaces the URL with `/l/:id`.
- The id is 12 characters of a 32-symbol alphabet — 60 bits, not guessable. The
  alphabet drops `i`, `l`, `o`, and `u` so a link survives being read aloud or
  retyped.
- **Share** in the list header copies the current URL.
- Anyone with the link can add, edit, tick off, and delete. There is no way to
  make someone read-only, and no way to take access back once a link is out.
  That is the design you asked for; it is worth knowing exactly what it means.

Nothing in a list is private from anyone holding the link, and a leaked link is a
leaked list. If that ever stops being acceptable, the smallest honest fix is a
second secret for write access, keeping the current id as read-only.

## Sync

The database is the single source of truth. Clients apply their own edits
immediately and reconcile against it.

- **Writes** are field-level `PATCH`es, so two people editing different fields of
  the same thing don't overwrite each other. Last write wins per field.
- **Reads are polled, not pushed.** A visible tab asks `/version` every 3
  seconds — the cheapest query in the app — and only fetches the whole list when
  the number has moved. Switching back to a tab checks immediately, so it's
  current the moment you return.
- **Typing is debounced** 450ms per item, and flushed early if the tab is
  backgrounded.

Polling rather than SSE is a consequence of where this runs: on a serverless
host a write and someone else's open connection can land on different function
instances, so there is nowhere to keep a subscriber list. Push would silently
reach some watchers and not others, which is worse than a three-second delay.
The self-hosted path in `docker-compose.yml` could support push, but it runs the
same code so the behaviour stays identical everywhere.

Two rules in [`useSyncedList.ts`](src/data/useSyncedList.ts) keep concurrent
editors from stepping on each other:

1. A server snapshot is only adopted when this client has **no writes in
   flight**. Otherwise it's marked stale and re-fetched once the writes settle —
   so an incoming snapshot can never revert a keystroke the user just made, and
   the client still converges.
2. **A focused text field owns its text.** Adopting a snapshot mid-word would
   move the caret out from under whoever is typing, so fields hold a local draft
   while focused and resync on blur.

Only visible tabs poll — a backgrounded tab asking every three seconds forever
would burn hosting quota for nobody's benefit. When a request fails a small dot
appears next to the count; edits keep working against the cached copy.

## API

| | |
|---|---|
| `POST /api/lists` | mint a list |
| `GET /api/lists/:id` | full state — `{ id, version, items }` |
| `GET /api/lists/:id/version` | `{ version }` — what polling hits |
| `POST /api/lists/:id/items` | `{ id, name }` |
| `PATCH /api/lists/:id/items/:itemId` | any of `name`, `price`, `model`, `where`, `why`, `bought` |
| `DELETE /api/lists/:id/items/:itemId` | |
| `GET /api/healthz` | |

Every mutation answers with the full new state, so the caller never needs a
follow-up read. Lengths are capped server-side (name 200, model/where 500, why
2000, 500 items per list) and prices must be a non-negative integer.

## Deploying

Free, no card: **Vercel** for hosting and **Turso** for the database. Vercel's
filesystem is ephemeral, so the SQLite file can't live there — Turso is the same
SQLite, managed, with a free tier far beyond what this needs. Every query and the
schema are unchanged.

### 1. Database

Sign up at [turso.tech](https://turso.tech) (GitHub login, no card), then create
a database and grab two values from the dashboard:

- the database **URL** (`libsql://…`)
- an **auth token**

### 2. Deploy

From this folder:

```bash
npx vercel
```

Accept the defaults — it detects Vite from `vercel.json`. No git repository is
required.

Then add the two secrets and redeploy to production:

```bash
npx vercel env add TURSO_DATABASE_URL
```

```bash
npx vercel env add TURSO_AUTH_TOKEN
```

```bash
npx vercel --prod
```

You get `https://<project>.vercel.app`. Open it, hit **Share**, send the link.

The schema is created on first request, so there is no migration step.

### How the pieces fit

- `vercel.json` builds the client to `dist/` (served by Vercel's CDN) and
  rewrites `/api/*` to a single function.
- `api/index.js` exports the Express app from `server/app.js`.
- `server/adapters.js` picks the database: Turso when `TURSO_DATABASE_URL` is
  set, otherwise a local file. That's the only difference between your machine
  and production.

### Alternative: self-hosting

`Dockerfile`, `docker-compose.yml`, and `fly.toml` are included for running it as
a normal always-on server with a local SQLite file on a volume. `docker compose
up -d --build` binds to `127.0.0.1:8080`; put Caddy or nginx in front for TLS.
Fly costs a few dollars a month; a VPS you already have costs nothing extra.

Back up the volume — with SQLite the whole database is one file, and nothing
else is keeping those lists.

### Configuration

| Variable | Default | |
|---|---|---|
| `TURSO_DATABASE_URL` | — | set it and the app uses Turso; unset means a local file |
| `TURSO_AUTH_TOKEN` | — | required with the above |
| `DB_FILE` | `./data/thngstbuy.db` | local-file mode only |
| `PORT` | `8787` | self-hosted only |
| `TRUST_PROXY` | `1` | proxy hops in front; `0` if exposed directly |
| `RATE_LIMIT_PER_MIN` | `900` | API requests per IP |
| `NEW_LISTS_PER_HOUR` | `30` | new lists per IP |

### TLS is not optional here

The list id travels in the URL and is the only credential. Over plain HTTP it is
visible to every network hop. Vercel is HTTPS by default; if you self-host, put a
TLS terminator in front.

For the same reason the server sends `X-Robots-Tag: noindex, nofollow` on every
response, ships a `robots.txt` that disallows everything, and sets
`Referrer-Policy: no-referrer` so a list URL can't leak through an outbound
click. Well-behaved crawlers will stay out; none of it helps if someone forwards
a link.

## The two layouts

The phone design was given. The wide layout is derived from it rather than
invented alongside it — same tokens, same type scale, same hairlines.

### Phone (< 640px)

The card **is** the screen: no canvas margin, no rounded corners, one flat
surface edge to edge, with the safe-area insets moved inside the card. The page
background matches the card so nothing beige shows through an overscroll bounce
or the gap a collapsing URL bar leaves.

That surface is `--surface` (`#FAF9F6`), a warm off-white rather than pure
white — it's the colour the design is built around. One token in
[`tokens.css`](src/styles/tokens.css) if you want `#FFF`.

### Tablet (640–899px)

The framed look returns: the card sits on the warm canvas again, capped at 560px,
because at that width there's room for the border to read as deliberate — and an
uncapped row would strand the price far from its name.

### Laptop (≥ 900px)

The card splits into a fixed list column (340–396px, roughly the phone's own
width) and a flexible right pane. The list keeps its header, total, and add bar
exactly as on the phone — it is the phone layout, unchanged, with a second pane
beside it. Three things change on the right:

- **The back chevron disappears.** There's nothing to go back to; the list never
  left.
- **The action buttons pick up labels** (`MARK BOUGHT`, `REMOVE`), set in the same
  tracked uppercase as the field labels and left-aligned with the content instead
  of centred. Icon-only circles read as deliberate under a thumb and as cryptic
  on a laptop.
- **Nothing selected shows a summary, not blank space.** A right pane that's empty
  half the time makes the window feel broken. The summary gives the total a
  headline treatment and adds the numbers the phone has no room for — how many
  things, how many unpriced, what's been waiting longest.

Prose in the detail pane is capped at 620px so *why* doesn't run the full width of
a monitor.

### Behaviour that differs by layout

| | Phone / tablet | Laptop |
|---|---|---|
| Adding an item | stays on the list | opens the new item, ready to fill in |
| Marking bought | closes the detail — you're done with it | stays open, so the change is visible and undoable |

## Notes on the build

- **Bought items** don't vanish. They collapse into an `01 BOUGHT` line that
  expands on click, so the default view stays as calm as the mockup. The header
  count and the total track pending items only.
- **Deleting takes two taps.** The first arms the button (it turns red and reads
  `TAP AGAIN`), the second commits; it disarms after 3.5s. A modal would be too
  heavy for the aesthetic, a bare trash icon too easy to hit.
- **Prices are typed loosely.** `450000`, `450 000`, `450k`, and `450 000 UZS` all
  parse. The field holds raw text while focused and groups digits on blur, so the
  formatter never fights the cursor.
- **Digit grouping is hand-rolled**, not `Intl.NumberFormat` — Hermes ships a
  trimmed ICU by default, and web and native should render `1 085 000` identically.
- **Empty names aren't written.** The server rejects them; the client keeps the
  blank locally until you type something rather than storing a placeholder.

## Layout of the source

```
vercel.json        build + rewrites for the hosted deploy
api/index.js       serverless entry: exports the Express app
Dockerfile         self-hosting image (local SQLite file on a volume)
docker-compose.yml self-hosting on a VPS
fly.toml           Fly.io alternative
server/
  app.js       the Express app, with no listen()
  index.js     local / self-hosted: listen + serve dist/
  adapters.js  Turso over HTTP, or node:sqlite on a file
  db.js        schema and queries, async
  ids.js       unguessable list ids
src/
  domain/      pure TypeScript — no React, no DOM, no fetch
    types.ts     Item shape
    items.ts     list rules: totals, ordering, position, mutations
    format.ts    money, dates, counts, loose price parsing
  data/
    api.ts           REST client
    useSyncedList.ts optimistic state, debounce, polling, reconciliation
    storage.ts       offline cache (localStorage)
  design/
    tokens.ts    colours, spacing, type scale as plain values
  ui/            web-only: components and CSS
  styles/
    tokens.css   mirrors design/tokens.ts
```

## The phone app

`app/` is an Expo (React Native) Android app, and a full peer of the website. The
same lists, the same links: `/l/shaxzod` opens the same list in a browser and on
the phone, and an edit made on either shows up on the other within a few seconds.

It also works with the network off. That is the part worth explaining, because it
is where the design is.

```bash
cd app
npm start
```

Scan the QR code with Expo Go, or press `a` for an emulator. To build something
installable, see [`app/README.md`](app/README.md).

The screens are a transcription of the website's phone layout — same tokens, same
type scale, same hairlines, same warm surface edge to edge. Two things the web
version doesn't have:

- **Swipe a row right** to tick it off. It fires as soon as you let go, because
  ticking something off is the common action and tapping the circle undoes it.
- **Swipe a row left** to reveal a Delete button, which you then press. Deleting
  isn't undoable, so the swipe only offers it and the press commits — the same
  two-step as the website's arming trash button.

### How offline works

The device's SQLite file is a **mirror** of what the server holds, not the truth.
Reads come from it, so the screen paints without waiting for the network. Writes
land in it first and are queued in an **outbox** — a table of ops in the order
they were made — which [`sync.ts`](app/src/sync.ts) replays against the server
when it can.

The reason this is not the hard problem it sounds like: the server's write API is
already **field-level patches keyed by client-generated UUIDs**
([`server/app.js`](server/app.js)). So replaying the outbox in order *is* the
merge. Two people editing different fields of one item both survive; the loser of
a same-field race is whoever arrived first. There is no version vector here
because none is needed.

What the engine does have to get right is two things:

1. **Draining stops at the first transient failure.** Skipping a stuck op to send
   the next one would let an older value overwrite a newer one, or apply a patch
   to an item whose `add` hasn't landed.
2. **A snapshot pulled while ops are still queued is rebased, not adopted.** This
   is subtler than it sounds. Adopting the response to op 1 replaces the mirror
   with a server snapshot that knows nothing about ops 2..n — so a failure at op
   2 would wipe work the user is looking at. The snapshot goes in, then the
   pending ops go back on top.

### What you get, and what you give up

| | |
| --- | --- |
| Edit offline | Yes — queued, and sent when you reconnect |
| Someone else's edits | Polled every 3s while the app is foregrounded |
| Same field, two people | Last write to arrive wins |
| Different fields, two people | Both survive |
| Edit something just deleted | The delete wins; the edit is dropped |
| Rename offline | No — see below |
| Start a new list offline | No — see below |

Two writes can't be queued, and both say so plainly rather than failing oddly:

- **Renaming.** Whether a name is free is a question only the server can answer,
  and an optimistic rename that later lost would change a URL somebody had
  already been given.
- **Creating a list.** `POST /lists` is what mints the id.

Everything else works with the phone in aeroplane mode.

### What is shared with the website

`src/domain/` — the list rules, money formatting and the `Item` shape — is used
verbatim by both. Metro is pointed at that folder in
[`app/metro.config.js`](app/metro.config.js) and resolves it under `@domain`, so
there is one copy of `pendingTotal`, `parsePrice` and the rest.

[`app/src/api.ts`](app/src/api.ts) is a near-copy of the web app's
[`src/data/api.ts`](src/data/api.ts) — same methods, same "every write returns the
whole new state" contract. It differs in three ways, all because it runs on a
phone: the base URL is absolute, requests time out after 15s, and there are no
cookies to send.

[`app/src/mirror.ts`](app/src/mirror.ts) transcribes the schema and every
statement from [`server/db.js`](server/db.js). That is what makes a mirror a
mirror: a snapshot can be dropped in wholesale and a queued write replayed
upstream without translation.

The UI is necessarily separate — CSS doesn't cross over — but
[`app/src/theme.ts`](app/src/theme.ts) is a direct transcription of the web
tokens, so the two stay in step by changing two files rather than by redesign.

### Tests

```bash
npm test          # server
cd app && npm test  # the phone app
```

`expo-sqlite` is a native module and cannot run under Node, so
[`app/src/sqlite.ts`](app/src/sqlite.ts) puts the storage layer behind the same
kind of adapter [`server/adapters.js`](server/adapters.js) already uses:
`expo-sqlite` on the phone, `node:sqlite` under vitest. The SQL the tests
exercise is the SQL the app runs.

[`app/src/sync.integration.test.ts`](app/src/sync.integration.test.ts) goes
further and runs the app's api client over real HTTP against the real Express app
— because the replay rules are only correct if they match what the routes
actually do with a repeated write, which a stand-in server cannot prove.

The screens have no tests. That needs `@testing-library/react-native`, and they
are covered for now by the typecheck and by the bundle building.

### Not verified on a device

The app typechecks, bundles for Android (1115 modules), prebuilds cleanly, and
its sync engine is tested against the real server. What has **not** been
exercised is any of it running on a phone — swipe feel, keyboard behaviour, font
rendering, whether the database is created where it should be on first launch,
and whether the offline path behaves the same when Android is the one deciding
you are offline. Build it, install it, and tell me what breaks.

`android.permission.INTERNET` is required, and now genuinely used.

## Not built

No accounts, no read-only links, no undo history, no conflict UI beyond
last-write-wins per field. No categories, quantities, or currencies other than
UZS. Lists are never garbage-collected — a `created_at`/`updated_at` sweep is the
obvious addition if this ever runs somewhere public.
