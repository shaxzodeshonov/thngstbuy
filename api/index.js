/**
 * Vercel serverless entry point. `vercel.json` rewrites every /api/* request
 * here, and Vercel's Node runtime calls the exported Express app as the handler.
 *
 * The static client is served by Vercel's CDN straight from dist/, so this
 * function only ever handles the API.
 */

import { createApp } from '../server/app.js'

export default createApp()
