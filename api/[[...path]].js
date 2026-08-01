/**
 * Vercel serverless entry point.
 *
 * The filename is an optional catch-all, so Vercel routes `/api` and
 * `/api/anything/deep` here natively — no rewrite in the middle that might or
 * might not preserve the original path. Vercel's Node runtime calls the
 * exported Express app as the handler.
 *
 * The static client is served by Vercel's CDN straight from dist/, so this
 * function only ever handles the API.
 */

import { createApp } from '../server/app.js'

export default createApp()
