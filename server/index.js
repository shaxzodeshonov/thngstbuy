/**
 * Local / self-hosted entry point: one long-running process that serves both
 * the API and the built client. Vercel uses `api/index.js` instead and never
 * runs this file.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import express from 'express'
import { createApp } from './app.js'
import * as db from './db.js'

/**
 * `--port` wins over `PORT` so `npm run dev` can pin the API to 8787 even when
 * the surrounding tooling exports a PORT of its own for the web server.
 */
function portFromArgv() {
  const flag = process.argv.indexOf('--port')
  return flag === -1 ? undefined : process.argv[flag + 1]
}

const PORT = Number(portFromArgv() ?? process.env.PORT ?? 8787)
const DIST = resolve(process.cwd(), 'dist')

const app = createApp()

// In development Vite serves the client and proxies /api here, so dist/ is
// only present for `npm start`.
if (existsSync(DIST)) {
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints everything under assets/, so those can be cached
        // forever. Anything else — index.html above all — must be revalidated
        // or a deploy never reaches people who already have the page.
        const fingerprinted = filePath.includes('assets')
        res.setHeader(
          'Cache-Control',
          fingerprinted ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
      },
    }),
  )

  // Every non-API path is a client route (`/`, `/l/:id`).
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(resolve(DIST, 'index.html'))
  })
}

const server = app.listen(PORT, () => {
  console.log(`thngstbuy listening on http://localhost:${PORT}`)
  if (!existsSync(DIST)) console.log('no dist/ — API only. Run `npm run build` to serve the app.')
})

// Containers send SIGTERM and kill after a grace period.
let closing = false
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (closing) return
    closing = true

    server.close(async () => {
      await db.close()
      process.exit(0)
    })

    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
