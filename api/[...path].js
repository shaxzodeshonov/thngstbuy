/**
 * Vercel serverless entry point.
 *
 * The filename is a catch-all, so Vercel routes `/api/healthz`,
 * `/api/lists/<id>`, and `/api/lists/<id>/items/<itemId>` all to this one
 * function, whatever their depth.
 *
 * Single brackets on purpose. `[[...path]]` is a Next.js convention; on a plain
 * Vercel Function it matches only one segment, which silently 404s every nested
 * route while the shallow ones keep working.
 *
 * The static client is served by Vercel's CDN straight from dist/, so this
 * function only ever handles the API.
 */

import { createApp } from '../server/app.js'

export default createApp()
