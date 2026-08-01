/**
 * Vercel serverless entry point.
 *
 * Routing to this file is done by an explicit rewrite in vercel.json rather
 * than by a bracketed filename. Both `[...path].js` and `[[...path]].js` were
 * matched as a single segment in this project, so `/api/healthz` worked while
 * `/api/lists/<id>` fell through to Vercel's own 404 - a difference that only
 * shows up once deployed.
 *
 * The rewrite hands the original path over in a `__path` query parameter, and
 * a middleware in server/app.js rebuilds `/api/...` from it. Both halves are
 * ours, so nothing depends on how the platform treats req.url.
 *
 * The static client is served by Vercel's CDN straight from dist/, so this
 * function only ever handles the API.
 */

import { createApp } from '../server/app.js'

export default createApp()
