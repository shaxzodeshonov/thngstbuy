/**
 * The Express app, with no `listen` — so it can be a long-running server
 * locally (`server/index.js`) and a serverless function on Vercel
 * (`api/index.js`) without either knowing about the other.
 *
 * There is deliberately no push channel here. On Vercel each request may land
 * on a different function instance, so an in-memory subscriber registry would
 * silently fail to reach half the watchers. Clients poll `/version` instead —
 * one tiny query, only while their tab is visible.
 */

import express from 'express'
import compression from 'compression'
import * as db from './db.js'
import { usingTurso } from './adapters.js'
import { isListId, newItemId, newListId } from './ids.js'

const LIMITS = { name: 200, model: 500, where: 500, why: 2000, itemsPerList: 500 }
const MAX_PRICE = 1_000_000_000_000

export function createApp() {
  const app = express()

  /**
   * Hosting platforms terminate TLS one hop in front of us. Without this
   * `req.ip` is the proxy for every visitor and the rate limiter would treat
   * the whole internet as one client. Exactly one hop — trusting all of them
   * would let anyone spoof X-Forwarded-For.
   */
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1))
  app.disable('x-powered-by')

  /**
   * Vercel's catch-all functions do not always hand the app the URL the browser
   * asked for. Depending on how the route was matched, the path segments can
   * arrive moved into a `path` query parameter instead, leaving `req.url`
   * pointing at the function file rather than `/api/lists/<id>`.
   *
   * Rebuilding the path here means every route below only ever sees `/api/...`,
   * whichever shape arrived. A normal server hits the early return and this
   * costs nothing.
   */
  app.use((req, _res, next) => {
    if (req.url.startsWith('/api/')) return next()

    const query = req.url.indexOf('?')
    if (query === -1) return next()

    const params = new URLSearchParams(req.url.slice(query + 1))
    const segments = params.getAll('path').filter(Boolean)
    if (segments.length === 0) return next()

    params.delete('path')
    const rest = params.toString()
    req.url = `/api/${segments.join('/')}${rest ? `?${rest}` : ''}`
    next()
  })

  app.use(compression())
  app.use(express.json({ limit: '64kb' }))

  app.use((_req, res, next) => {
    // A list URL is the only credential this app has, so it must never end up
    // in a search index. Paired with public/robots.txt and a meta tag.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
  })

  const api = express.Router()

  /**
   * Reports which database it's actually talking to. `store: "file"` on a
   * hosted deploy is the single most useful signal that the Turso environment
   * variables never arrived. No secrets — just which branch was taken.
   */
  api.get('/healthz', async (_req, res) => {
    try {
      await db.readVersion('healthcheck0')
      res.json({ ok: true, store: usingTurso ? 'turso' : 'file' })
    } catch (error) {
      res.status(503).json({
        ok: false,
        store: usingTurso ? 'turso' : 'file',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  api.use(
    rateLimit({
      windowMs: 60_000,
      max: Number(process.env.RATE_LIMIT_PER_MIN ?? 900),
      message: 'Too many requests — slow down for a moment.',
    }),
  )

  /** Start a new list. The response id becomes the shareable URL. */
  api.post(
    '/lists',
    rateLimit({
      windowMs: 60 * 60_000,
      max: Number(process.env.NEW_LISTS_PER_HOUR ?? 30),
      message: 'Too many new lists from this address. Try again later.',
    }),
    async (_req, res) => {
      res.status(201).json(await db.createList(newListId()))
    },
  )

  /**
   * The polling endpoint. Deliberately the cheapest query in the app: clients
   * hit it every few seconds and only fetch the whole list when the number moves.
   */
  api.get('/lists/:id/version', async (req, res) => {
    const { id } = req.params
    const version = isListId(id) ? await db.readVersion(id) : null
    if (version === null) return res.status(404).json({ error: 'no such list' })

    res.setHeader('Cache-Control', 'no-store')
    res.json({ version })
  })

  api.get('/lists/:id', async (req, res) => {
    const state = await readOr404(req, res)
    if (state) {
      res.setHeader('Cache-Control', 'no-store')
      res.json(state)
    }
  })

  api.post('/lists/:id/items', async (req, res) => {
    const state = await readOr404(req, res)
    if (!state) return

    const name = text(req.body?.name, LIMITS.name)
    if (!name) return res.status(400).json({ error: 'name is required' })

    if ((await db.itemCount(state.id)) >= LIMITS.itemsPerList) {
      return res.status(409).json({ error: `a list holds at most ${LIMITS.itemsPerList} things` })
    }

    // The client generates the id so its optimistic row and the stored row match.
    const itemId = isUuid(req.body?.id) ? req.body.id : newItemId()
    await db.addItem(state.id, itemId, name)

    res.status(201).json(await db.readList(state.id))
  })

  api.patch('/lists/:id/items/:itemId', async (req, res) => {
    const state = await readOr404(req, res)
    if (!state) return

    const patch = {}
    const body = req.body ?? {}

    for (const key of ['name', 'model', 'where', 'why']) {
      if (key in body) {
        const value = text(body[key], LIMITS[key])
        if (value === null && key === 'name') {
          return res.status(400).json({ error: 'name cannot be empty' })
        }
        patch[key] = value ?? ''
      }
    }

    if ('price' in body) {
      const price = body.price
      if (price !== null && (!Number.isFinite(price) || price < 0 || price > MAX_PRICE)) {
        return res.status(400).json({ error: 'price is out of range' })
      }
      patch.price = price === null ? null : Math.round(price)
    }

    if ('bought' in body) patch.bought = Boolean(body.bought)

    if (!(await db.patchItem(state.id, req.params.itemId, patch))) {
      return res.status(404).json({ error: 'no such item' })
    }

    res.json(await db.readList(state.id))
  })

  api.delete('/lists/:id/items/:itemId', async (req, res) => {
    const state = await readOr404(req, res)
    if (!state) return

    if (!(await db.removeItem(state.id, req.params.itemId))) {
      return res.status(404).json({ error: 'no such item' })
    }

    res.json(await db.readList(state.id))
  })

  /**
   * Mounted twice on purpose. Running as a normal server every request arrives
   * as `/api/lists/…`. Behind Vercel's rewrite the function may be handed the
   * path with the `/api` prefix already consumed. Accepting both costs one line
   * and removes a failure mode that only shows up after deploying.
   */
  app.use('/api', api)
  app.use('/', api)

  /**
   * A bare 404 from Express looks identical to a routing misconfiguration and
   * tells nobody which it was. Echoing the path the app actually received turns
   * "it just 404s" into a one-request diagnosis.
   */
  app.use((req, res, next) => {
    // On Vercel the CDN serves the client, so anything reaching this function is
    // API traffic. Self-hosted, the same app also serves dist/, so only claim
    // /api here and let everything else fall through to the static handler.
    const isApiTraffic = req.url.startsWith('/api') || Boolean(process.env.VERCEL)
    if (!isApiTraffic) return next()

    res.status(404).json({
      error: 'No route matched inside the app.',
      pathSeen: req.url,
      originalUrl: req.originalUrl,
    })
  })

  // Express 5 forwards rejected promises here, so a database outage answers
  // with JSON the client can show rather than an empty 500.
  app.use((error, _req, res, _next) => {
    console.error(error)
    // The message is surfaced to the client on purpose: with no login and no
    // log access from a phone, a blank "something went wrong" makes a broken
    // deploy impossible to diagnose. Nothing here contains a secret.
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Something went wrong on the server.',
    })
  })

  return app
}

/* ------------------------------------------------------------- helpers -- */

async function readOr404(req, res) {
  const { id } = req.params
  const state = isListId(id) ? await db.readList(id) : null
  if (!state) {
    res.status(404).json({ error: 'no such list' })
    return null
  }
  return state
}

function text(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.slice(0, max).trim()
  return trimmed.length === 0 ? null : trimmed
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)
}

/**
 * Fixed-window counter, per IP. There is no login, so this is the only thing
 * standing between the API and someone filling the database with empty lists.
 *
 * On serverless this is per-instance rather than global, which makes it a
 * speed bump instead of a wall — still enough to stop a naive script.
 */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map()
  const reset = setInterval(() => hits.clear(), windowMs)
  reset.unref?.()

  return (req, res, next) => {
    const key = req.ip ?? 'unknown'
    const count = (hits.get(key) ?? 0) + 1
    hits.set(key, count)

    if (count > max) return res.status(429).json({ error: message })
    next()
  }
}
