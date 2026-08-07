/**
 * Where the list lives.
 *
 * The website can say `/api` and let the browser fill in the host. A phone has
 * no such context, so this is the one piece of deployment knowledge the app
 * carries around with it.
 */

declare const __DEV__: boolean

const PRODUCTION = 'https://thngstbuy.vercel.app'

/**
 * In development this can be pointed at a machine on the same network —
 * `npm run dev:api` at the repo root serves the same Express app on 8787:
 *
 *   EXPO_PUBLIC_API_BASE=http://192.168.1.20:8787 npm start
 *
 * The override is deliberately development-only. Android blocks cleartext HTTP
 * in release builds, so a plain-http value that leaked into one would fail at
 * runtime rather than at build time, which is the worst place to find out.
 */
export const API_BASE =
  __DEV__ && process.env.EXPO_PUBLIC_API_BASE ? process.env.EXPO_PUBLIC_API_BASE : PRODUCTION

/**
 * The link handed to someone else. Always the production host — a link is
 * useless to the person receiving it if it points at a laptop on your desk.
 */
export const shareUrl = (slug: string) => `${PRODUCTION}/l/${slug}`
