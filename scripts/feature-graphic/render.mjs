// Renders feature-graphic.html to store-assets/play/feature-graphic.png at
// exactly 1024 x 500, as a PNG with no alpha (what the Play Console asks for).
//
//   node scripts/feature-graphic/render.mjs
//
// Uses the Chrome on this machine, as the end-to-end run does.
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../../store-assets/play/feature-graphic.png')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(resolve(here, 'feature-graphic.html')).href)
await page.evaluate(() => document.fonts.ready)
const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1024, height: 500 } })
// How far the text runs, so a change of copy that crowds the right edge is seen here.
const right = await page.evaluate(() => Math.round(document.querySelector('.text').getBoundingClientRect().right))
await browser.close()

await sharp(shot).removeAlpha().png().toFile(out)
const meta = await sharp(out).metadata()
console.log(`${out}\n${meta.width} x ${meta.height}, alpha: ${meta.hasAlpha}, text ends ${1024 - right}px from the right edge`)
