# thngstbuy

A shared list for things you're thinking about buying.

**[thngstbuy.vercel.app](https://thngstbuy.vercel.app)**

## Why

I kept wanting things and forgetting which ones. Notes app, Telegram saved messages, screenshots in the gallery — three places, none of them useful when I was actually standing in a shop deciding.

So every item here holds a price and three notes: **which model, where, and why**. The "why" is the important one. Half the time I write it out and realize I don't want the thing.

No accounts, no login. The URL is the credential — open the app, get a link, send the link. Anyone holding it can read and write. That's the whole sharing model, which is either the best or worst part depending on who you send it to.

## Stack

- **React 19 + TypeScript + Vite 7** — frontend
- **Express 5 on Node 22.5+** — API
- **SQLite** via `@libsql/client` — a local file in dev, Turso in production
- **Docker + docker-compose** — for running the whole thing in one command
- **Vercel** (free path) or **Fly.io** with a persistent volume (paid path)

Two ways to deploy because I wanted the free one to actually work, not just be documented.

List IDs are 12 characters from a 32-symbol alphabet — 60 bits, not guessable. I dropped `i`, `l`, `o`, and `u` so a link survives being read out loud or retyped by hand.

## Run it

```bash
npm install
npm run dev
```

## The phone app

`app/` is an Expo (React Native) Android app, and a full peer of the website. The
same lists, the same links: `/l/shaxzod` opens the same list in a browser and on
the phone, and an edit made on either shows up on the other within a few seconds.

It also works with the network off. That is the part worth explaining, because it
is where the design is.
`http://localhost:5173`. Runs the API on `8787` and Vite on `5173` with a proxy between them. No account and no network needed — it writes to `data/thngstbuy.db` using Node's built-in SQLite.

```bash
npm run build      # tsc -b && vite build
npm run typecheck
npm start          # production server
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
Deployment steps are in the full docs.

## Known limits

- Anyone with the link has full write access. There's no read-only mode and no way to revoke a link once it's out.
- One machine only on Fly — the SQLite file lives on that instance's volume, so scaling to two would serve two different databases.
