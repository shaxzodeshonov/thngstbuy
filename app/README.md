# Things to buy — the phone app

A shopping list for Android. Add what you want to buy, why you want it, what it
costs and where to get it, then tick things off as you buy them.

**This app keeps its list on your phone.** No account, no sign-in, no network. It
works with the phone in aeroplane mode. It does **not** sync with the website —
a list on this phone is this phone's list. See [What it can't do](#what-it-cant-do).

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

Swipe-right fires the moment you let go, because ticking things off is the thing
you do most. Swipe-left only *offers* Delete and the press commits it — deleting
isn't undoable, so it deliberately takes two actions.

**The detail screen** holds the fields that make the list worth keeping: the
price, which model or variant you actually want, where to get it, and *why* you
want it. That last one is the field that talks you out of things.

**Naming the list** gives it a name you'll recognise instead of a generated one.
The last list you opened is remembered, so reopening the app takes you back to it
rather than starting an empty one.

---

## What it can't do

Worth knowing before you rely on it:

- **No sharing.** Nobody else can see or edit your list. There's no link to send.
- **No sync with the website.** They're separate lists that happen to look alike.
- **No backup.** The list lives in the app's storage. Uninstalling the app, or
  clearing its data, deletes it permanently. There's no export.
- **One device.** A new phone starts empty.

If you want any of those, that's the change designed in
[`docs/superpowers/specs/2026-08-07-offline-first-phone-app-design.md`](../docs/superpowers/specs/2026-08-07-offline-first-phone-app-design.md)
— it isn't built yet.

---

## Is this a full app or a demo?

**It's a full app, not a demo** — with one honest caveat.

Nothing in it is faked. There are no placeholder screens, no stub buttons, no
sample data, no "coming soon". Every feature described above is really
implemented: the database is real SQLite, edits really persist, the swipes really
work, the list survives restarts. It typechecks and bundles cleanly, and every
database statement has been run against real SQLite.

The caveat: **it has never been run on a physical phone.** It has been built and
typechecked, but nobody has held it. Font rendering, how the swipes actually feel
under a thumb, keyboard behaviour, and whether the database is created correctly
on first launch are all unverified on real hardware. Expect rough edges on the
first run, not missing features.

It is also *complete but small on purpose* — it does one thing, and it is not a
cut-down version of the website. It's a different answer to a different question:
the website is a list you share via a link, this is a list that's yours alone and
works with no connection.

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

---

## For developers

```bash
cd app
npm start          # Metro, with the QR code
npm run android    # build and run on a connected device or emulator
npm run typecheck  # tsc --noEmit
```

The list rules, money formatting and the `Item` shape live in `../src/domain` and
are shared verbatim with the web app; Metro resolves that folder as `@domain`
(see [`metro.config.js`](metro.config.js)). [`src/localStore.ts`](src/localStore.ts)
is the local database and exposes the same methods the web app's `api.ts` did.
[`src/theme.ts`](src/theme.ts) transcribes the web design tokens.

The main [README](../README.md) covers the website and the server.
