// Placeholder phone screenshots for the Play listing: the web app at a phone's
// size, on its sample data. Stand-ins until real ones are made on a device.
//
//   npm run dev                              (in another terminal)
//   node scripts/placeholder-screenshots.mjs
//
// 400 x 800 CSS px at 2.7x is 1080 x 2160: exactly Play's limit of 2:1, which
// a raw capture from most phones (1080 x 2400) is over. PNG with no alpha.
// Uses the Chrome on this machine, as the end-to-end run does.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../store-assets/play/phone-placeholder')
const APP = process.env.APP_URL ?? 'http://localhost:5190/'
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function run(scheme, shots) {
  const context = await browser.newContext({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 2.7, isMobile: true, hasTouch: true, colorScheme: scheme })
  const page = await context.newPage()
  await page.goto(APP)
  await page.getByText('Explore with sample data').click()
  await page.getByText('Needs a decision').first().waitFor()
  // The note about sample data is true of this capture and wrong for a listing.
  const hideNote = () => page.evaluate(() => {
    const hit = [...document.querySelectorAll('p, span, div')].find((e) => e.childElementCount === 0 && e.textContent.startsWith('You are looking at sample data'))
    let box = hit
    while (box && !box.textContent.includes('Remove samples')) box = box.parentElement
    if (box) box.style.display = 'none'
  })
  const save = async (name) => {
    await hideNote()
    // Off the page, so no row is caught in its hover state.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1200)
    const file = `${OUT}/${name}.png`
    await sharp(await page.screenshot({ type: 'png' })).removeAlpha().png().toFile(file)
    const meta = await sharp(file).metadata()
    console.log(`${name}  ${meta.width} x ${meta.height}  alpha: ${meta.hasAlpha}`)
  }
  await shots(page, save)
  await context.close()
}

const tab = (page, label) => page.getByRole('button', { name: label, exact: true }).last().click()
// Brings a heading to just under the app's header, whichever element scrolls.
const scrollTo = (page, heading) => page.evaluate((text) => {
  const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === text)
  if (!h) return
  const y = h.getBoundingClientRect().top + window.scrollY - 90
  ;(document.scrollingElement ?? document.documentElement).scrollTo(0, y)
  for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = Math.max(el.scrollTop, y)
}, heading)

await run('light', async (page, save) => {
  await save('1-glance')
  await scrollTo(page, 'Needs a decision')
  await save('2-decide')
  await tab(page, 'Horizon')
  await save('3-horizon')
  await tab(page, 'Things')
  await save('4-things')
  await tab(page, 'Plans')
  await save('5-plans')
})
await run('dark', async (page, save) => { await save('6-glance-dark') })
await browser.close()
