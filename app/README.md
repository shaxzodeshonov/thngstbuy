# Things to buy — the phone app

A shopping list for Android. Add what you want to buy, why you want it, what it
costs and where to get it, then tick things off as you buy them.

**Your list is shared, and it works offline.** No account and no sign-in — the
link is the only key. Send someone the link and you are both editing the same
list, on phones or in a browser. Edit it with no signal and your changes are
saved on the phone and sent the moment you reconnect.

See [What it can't do](#what-it-cant-do) for the honest limits.

---

## Run it right now (2 minutes)

The fastest way to see it, without building anything.

1. Install **Expo Go** from the Play Store on your phone.
2. Put the phone and this computer **on the same Wi-Fi**.
3. Run:

```bash
cd app && npm start
```

4. Scan the QR code in the terminal with Expo Go.

The app opens on your phone. Edits are saved on the phone and survive closing it.

**This is not an install.** It runs inside Expo Go, needs this computer running,
and the list disappears if you clear Expo Go's data. For something that lives on
your phone properly, build the APK below.

---

## Install it properly (the APK)

This produces a real app: its own icon in your launcher, no computer needed, no
Expo Go.

Expo's servers do the compiling, so you don't need the Android SDK — which
matters here, because this machine doesn't have it, and the JDK installed is
version 26, which React Native 0.86 can't use.

```bash
cd app && npx eas-cli build --platform android --profile preview
```

**You will be asked to log in.** Create a free Expo account when prompted — it
needs no card. The first run also offers to generate an Android signing key; say
yes and let Expo keep it.

The build takes roughly 10–20 minutes. When it finishes you get a URL.

**On the phone:** open that URL in the phone's browser and download the `.apk`.
Tap the downloaded file. Android will warn about installing from an unknown
source — that warning is expected for any app not from the Play Store. Allow it
for your browser, then install.

Done. The app is on your phone and the computer is no longer involved.

### If you'd rather build it on this machine

You'd need to install the Android SDK (several GB) and a second JDK — 17 or 21,
because 26 fails with an unhelpful `unsupported class file major version`. Then:

```bash
cd app/android && ./gradlew assembleRelease
```

The APK lands in `app/android/app/build/outputs/apk/release/`. The cloud build
above is less setup for the same result.

---

## Using it

**The list screen** shows what you still want to buy, with a running total of the
prices you've filled in. Bought things collapse into a separate section you can
fold away.

| To do this | Do that |
| --- | --- |
| Add something | Type in the bar at the bottom, press return |
| Open the details | Tap the row |
| Tick it off | **Swipe the row right**, or tap the circle |
| Un-tick it | Tap the circle again |
| Delete it | **Swipe the row left**, then press Delete |
| Name the list | Press **Name** in the header |
| Send it to someone | Press **Share** in the header |

Swipe-right fires the moment you let go, because ticking things off is the thing
you do most. Swipe-left only *offers* Delete and the press commits it — deleting
isn't undoable, so it deliberately takes two actions.

**The detail screen** holds the fields that make the list worth keeping: the
price, which model or variant you actually want, where to get it, and *why* you
want it. That last one is the field that talks you out of things.

**Naming the list** gives it a name you'll recognise instead of a generated one —
`thngstbuy.vercel.app/l/kitchen` rather than a jumble of letters. A link you gave
someone *before* the rename keeps working, so renaming never strands anybody.

**Sharing** sends that link over whatever your phone offers. Anyone who opens it
is editing the same list as you: in their browser, or in this app if they have
it. There's no invite and no accepting — the link is the key.

---

## Sharing and offline

Two things worth understanding, because they're most of what the app is.

**Anyone with the link can edit.** That's the whole design, not an oversight.
There are no accounts, so the link *is* the password. Don't put anything in a
list you wouldn't hand to whoever might end up with the URL, and be aware that a
short name like `/l/kitchen` is much easier to guess than the generated one.

**Offline edits are saved and sent later.** Add, edit, tick off and delete with
no signal at all; the header quietly says how many changes are waiting. Reconnect
and they go. You'll only notice it worked.

Two things do need a connection, and say so rather than failing strangely:
renaming a list, and starting a new one. Both need the server to answer a
question the phone can't ("is this name free?", "what id do I get?").

When two people change the same thing at once:

- **Different fields** — both survive. Your price and their note both stick.
- **The same field** — the later write wins.
- **One edits, one deletes** — the delete wins.

---

## What it can't do

Worth knowing before you rely on it:

- **No privacy beyond the link.** No accounts, no read-only sharing, no way to
  revoke a link once you've sent it.
- **No backup or export.** If the list is deleted, it's gone.
- **No undo.** Deleting takes two actions precisely because of this.
- **A brand-new list needs a connection.** So does renaming one.
- **Android only, in practice.** The iOS side is configured but has never been
  built or tested.

---

## Is this a full app or a demo?

**It's a full app, not a demo** — with one honest caveat.

Nothing in it is faked. There are no placeholder screens, no stub buttons, no
sample data, no "coming soon". Every feature described above is really
implemented: real SQLite on the device, real HTTP to a real deployed server,
edits that really persist and really sync.

It is tested, which is the part that separates a demo from an app. 44 tests
covering the storage layer, the outbox, the merge rules and the API client — and
ten of them run the app's own networking against the real Express server over
real HTTP, because the offline replay rules are only correct if they match what
the routes actually do.

The caveat: **it has never been run on a physical phone.** It typechecks, it
bundles, and its engine is tested, but nobody has held it. Font rendering, how
the swipes actually feel under a thumb, keyboard behaviour, whether the database
is created correctly on first launch, and how it behaves when Android — rather
than a test — is the one deciding you're offline, are all unverified on real
hardware. Expect rough edges on the first run, not missing features.

It is also *complete but small on purpose*. It does one thing. It is not a
cut-down version of the website; it's the same list, reached a different way.

The branch is called `appdemo`, which undersells it.

---

## Troubleshooting

**The QR code won't connect.** Phone and computer must be on the same Wi-Fi, and
some networks (public, corporate, guest) block devices from talking to each
other. Try a phone hotspot, or use the APK.

**Expo Go says the SDK version is wrong.** Expo Go only supports the current SDK.
Update Expo Go from the Play Store; if that doesn't fix it, use the APK, which
doesn't depend on Expo Go at all.

**`unsupported class file major version` on a local Gradle build.** JDK 26 is too
new. Install JDK 17 or 21 and point `JAVA_HOME` at it, or use the cloud build.

**Android won't install the APK.** Allow "install unknown apps" for the browser
you downloaded it with. If it says the app conflicts with an existing one,
uninstall the old copy first — a rebuild signed with a different key can't
upgrade in place.

**The header says changes are waiting and they never go.** The app is not
reaching the server. Check the phone has a working connection — a Wi-Fi network
with a sign-in page counts as connected to Android but not to us. Nothing is
lost while it waits; the queue survives the app being closed.

**Someone else's edits aren't showing up.** The app checks every few seconds
while it's open and in front of you. Backgrounded, it stops, to save your
battery — come back to it and it refreshes immediately.

**Renaming says it needs a connection.** It does. Whether a name is free is a
question only the server can answer, so unlike everything else this can't be
queued for later.

---

## For developers

```bash
cd app
npm start          # Metro, with the QR code
npm run android    # build and run on a connected device or emulator
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

To work against a server on your own machine rather than the deployed one, run
`npm run dev:api` at the repo root and point the app at your LAN address:

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.20:8787 npm start
```

The override is development-only on purpose — Android blocks cleartext HTTP in
release builds, and a plain-http URL that leaked into one would fail at runtime
rather than at build time.

**The layers**, outermost first:

| | |
| --- | --- |
| [`src/useSyncedList.ts`](src/useSyncedList.ts) | What the screens use. Optimistic state, per-item debounce, the poll loop |
| [`src/sync.ts`](src/sync.ts) | Drain the queue, pull changes, rebase, track the connection |
| [`src/outbox.ts`](src/outbox.ts) | Writes that haven't reached the server, in order |
| [`src/mirror.ts`](src/mirror.ts) | The device's copy of the list |
| [`src/api.ts`](src/api.ts) | The server |
| [`src/sqlite.ts`](src/sqlite.ts) | expo-sqlite on the phone, node:sqlite in tests |

The list rules, money formatting and the `Item` shape live in `../src/domain` and
are shared verbatim with the web app; Metro resolves that folder as `@domain`
(see [`metro.config.js`](metro.config.js)). [`src/theme.ts`](src/theme.ts)
transcribes the web design tokens.

The main [README](../README.md) explains why the merge is just "replay the queue
in order", and covers the website and the server.
