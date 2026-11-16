#!/usr/bin/env node
// Desktop app icons (docs/desktop.md), rendered from the same artwork as the
// PWA's (public/icons/icon.svg) into electron/resources/:
//
//   icon-mac.png  1024px, Apple's macOS grid: the artwork clipped to an 824px
//                 rounded square, centered on a transparent canvas with a soft
//                 shadow. A full-bleed square, as a phone uses, reads oversized
//                 and unrounded in the Dock next to every other Mac app.
//   icon.png      1024px, icon.svg as is (its own ~18% rounding), for Windows
//                 and Linux, where electron-builder derives the .ico and the
//                 hicolor PNG set from it.
//   tray/         the tray icon: the mark alone, the lifespan ring with three
//                 quarters of its life left around the thing in the middle.
//                 trayTemplate.png and @2x for the macOS menu bar (black and
//                 alpha only; macOS tints it), tray.png and @2x in the brand's
//                 sky blue on the icon's dark ground for Windows and Linux.
//                 Shipped as extraResources.
//
// Run after a brand change and commit the output:
//
//   node scripts/gen-desktop-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const icon = fs.readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf-8')
const outDir = path.join(root, 'electron/resources')
fs.mkdirSync(outDir, { recursive: true })

const CANVAS = 1024
const BODY = 824 // Apple's icon grid: 824px body on a 1024px canvas.
const OFFSET = (CANVAS - BODY) / 2
const RADIUS = 185.4 // The grid's corner radius for an 824px body.

// The artwork, as an embeddable <svg> scaled to the body size. Its own corners
// are rounder than a square's and less round than Apple's, so the clip below
// is what shows.
const artwork = icon.replace(/<svg([^>]*?)\swidth="512"\sheight="512"/, `<svg$1 x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}"`)

const macSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <clipPath id="body"><rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}"/></clipPath>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <rect x="${OFFSET}" y="${OFFSET}" width="${BODY}" height="${BODY}" rx="${RADIUS}" fill="#05081A" filter="url(#shadow)"/>
  <g clip-path="url(#body)">${artwork}</g>
</svg>`

await sharp(Buffer.from(macSvg)).png().toFile(path.join(outDir, 'icon-mac.png'))
await sharp(Buffer.from(icon), { density: 72 * (CANVAS / 512) }).resize(CANVAS, CANVAS).png().toFile(path.join(outDir, 'icon.png'))

// The tray mark, in a 22pt image: the ring with a quarter of it spent, and the
// thing in the middle. `scale` is 1 or 2. The template is black and alpha
// only. The colour version sits on the icon's dark ground, in a rounded
// square, so it shows on light and dark taskbars alike.
function traySvg(scale, { ground, track, ring, thing }) {
  const u = (n) => n * scale
  const size = u(22)
  const c = size / 2
  const r = u(ground ? 6.2 : 7.6)
  const sw = u(ground ? 1.9 : 2)
  const around = 2 * Math.PI * r
  const side = u(ground ? 4.2 : 5)
  const back = ground ? `<rect x="${u(1)}" y="${u(1)}" width="${size - u(2)}" height="${size - u(2)}" rx="${u(4.6)}" fill="${ground}"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${back}
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${sw}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${ring}" stroke-width="${sw}" stroke-linecap="round"
            stroke-dasharray="${around * 0.72} ${around}" transform="rotate(-90 ${c} ${c})"/>
    <rect x="${c - side / 2}" y="${c - side / 2}" width="${side}" height="${side}" rx="${u(1.2)}" fill="${thing}"/></svg>`
}
const trayDir = path.join(outDir, 'tray')
fs.mkdirSync(trayDir, { recursive: true })
for (const [scale, suffix] of [[1, ''], [2, '@2x']]) {
  await sharp(Buffer.from(traySvg(scale, { ground: null, track: 'rgba(0,0,0,0.3)', ring: '#000000', thing: '#000000' })))
    .png().toFile(path.join(trayDir, `trayTemplate${suffix}.png`))
  await sharp(Buffer.from(traySvg(scale, { ground: '#05081A', track: '#1D2538', ring: '#7DD3FC', thing: '#7DD3FC' })))
    .png().toFile(path.join(trayDir, `tray${suffix}.png`))
}

console.log('wrote electron/resources/icon-mac.png, icon.png and tray/')
