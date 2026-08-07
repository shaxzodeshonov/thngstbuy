/**
 * Draws the launcher icons from the same mark the website uses as its favicon
 * (public/icon.svg): the unchecked circle from a list row, and the dash beside
 * it.
 *
 *   node scripts/make-icons.mjs
 *
 * Why by hand rather than with a converter: the mark is three shapes, and every
 * SVG rasteriser worth using is a native dependency that then has to be
 * installed on every machine that ever regenerates an icon. Signed distance
 * fields give better antialiasing than most of them anyway, and this file is
 * shorter than the install instructions would be.
 *
 * Outputs, both 1024x1024:
 *   assets/icon.png           the square icon, background included
 *   assets/adaptive-icon.png  Android's foreground layer, transparent, with the
 *                             mark shrunk into the safe zone Android will mask
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SIZE = 1024

/** From public/icon.svg, which is drawn on a 32x32 grid. */
const VIEWBOX = 32
const SURFACE = [0xfa, 0xf9, 0xf6]
const ACCENT = [0xa2, 0x8b, 0x68]
const INK = [0x1c, 0x1b, 0x19]

const CIRCLE = { cx: 11, cy: 16, r: 4.25, stroke: 1.75 }
const DASH = { x1: 19, x2: 25, y: 16, stroke: 1.75 }
const CORNER = 8

/**
 * Android masks the adaptive foreground to a shape that can be as small as a
 * circle covering the middle 66%. The mark spans about 63% of the artboard at
 * full size, which would graze the mask, so it is drawn smaller on that layer.
 */
const ADAPTIVE_SCALE = 0.62

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Coverage from a signed distance, in pixels. Negative is inside. */
const coverage = (distance, aa) => clamp01(0.5 - distance / aa)

function roundedRectDistance(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius)
  const dy = Math.abs(y) - (half - radius)
  const ox = Math.max(dx, 0)
  const oy = Math.max(dy, 0)
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(dx, dy), 0) - radius
}

/** Distance to a line segment's centreline, for a round-capped stroke. */
function segmentDistance(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1
  const vy = y2 - y1
  const wx = px - x1
  const wy = py - y1
  const t = clamp01((wx * vx + wy * vy) / (vx * vx + vy * vy))
  const dx = wx - t * vx
  const dy = wy - t * vy
  return Math.sqrt(dx * dx + dy * dy)
}

/** Paints `colour` over `onto` with the given coverage. */
function over(onto, colour, alpha) {
  if (alpha <= 0) return
  const a = onto[3] + alpha * (1 - onto[3])
  for (let c = 0; c < 3; c++) {
    onto[c] = (onto[c] * onto[3] * (1 - alpha) + colour[c] * alpha) / (a || 1)
  }
  onto[3] = a
}

function render({ background }) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4)
  const scale = SIZE / VIEWBOX
  // One pixel, in viewBox units — the width the antialiasing ramp spans.
  const aa = VIEWBOX / SIZE

  const marks = background ? 1 : ADAPTIVE_SCALE
  const centre = VIEWBOX / 2

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      // Pixel centre, in viewBox units.
      const x = (px + 0.5) / scale
      const y = (py + 0.5) / scale
      const rgba = [0, 0, 0, 0]

      if (background) {
        const d = roundedRectDistance(x - centre, y - centre, centre, CORNER)
        over(rgba, SURFACE, coverage(d, aa))
      }

      // The mark, optionally shrunk about the centre of the artboard.
      const mx = centre + (x - centre) / marks
      const my = centre + (y - centre) / marks
      const markAa = aa / marks

      // Ring: the circle's stroke is the band around its radius.
      const ring = Math.abs(Math.hypot(mx - CIRCLE.cx, my - CIRCLE.cy) - CIRCLE.r) - CIRCLE.stroke / 2
      over(rgba, ACCENT, coverage(ring, markAa))

      // Dash: a round-capped segment.
      const dash = segmentDistance(mx, my, DASH.x1, DASH.y, DASH.x2, DASH.y) - DASH.stroke / 2
      over(rgba, INK, coverage(dash, markAa))

      const at = (py * SIZE + px) * 4
      pixels[at] = Math.round(rgba[0])
      pixels[at + 1] = Math.round(rgba[1])
      pixels[at + 2] = Math.round(rgba[2])
      pixels[at + 3] = Math.round(rgba[3] * 255)
    }
  }

  return pixels
}

/* ------------------------------------------------------------ PNG encoding */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function toPng(pixels) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // truecolour with alpha
  // compression, filter, interlace — all the only value PNG defines.

  // Each row is prefixed with its filter type. Filter 0 (none) keeps this
  // readable; the image is flat colour and deflate handles it well regardless.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    const from = y * SIZE * 4
    raw[y * (SIZE * 4 + 1)] = 0
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, from, from + SIZE * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------- write */

const out = join(HERE, '..', 'assets')
mkdirSync(out, { recursive: true })

for (const [file, background] of [
  ['icon.png', true],
  ['adaptive-icon.png', false],
]) {
  const png = toPng(render({ background }))
  writeFileSync(join(out, file), png)
  console.log(`${file}  ${SIZE}x${SIZE}  ${(png.length / 1024).toFixed(1)}KB`)
}
