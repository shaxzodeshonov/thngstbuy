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

`http://localhost:5173`. Runs the API on `8787` and Vite on `5173` with a proxy between them. No account and no network needed — it writes to `data/thngstbuy.db` using Node's built-in SQLite.

```bash
npm run build      # tsc -b && vite build
npm run typecheck
npm start          # production server
```

Deployment steps are in the full docs.

## Known limits

- Anyone with the link has full write access. There's no read-only mode and no way to revoke a link once it's out.
- One machine only on Fly — the SQLite file lives on that instance's volume, so scaling to two would serve two different databases.
