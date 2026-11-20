// Store captures: the app itself, unframed, at the sizes the family's
// screenshot kit takes as input. The kit adds the device, the status bar and
// the caption; what goes in is the app's own surface and nothing else.
//
//   npm run dev                                  (in another terminal)
//   node scripts/store-captures.mjs [dark|light|both] [device ...]
//
// Dark by default, as the family's store shots are. Devices: iphone, ipad,
// ipad-portrait, mac, mac-plain, pixel (all of them when none is named).
// Written to store-assets/captures/<device>/, which git ignores: they are
// regenerated, and the framed set made from them is what gets committed.
//
// Sizes. The kit wants a device's content area, never its screen, so these are
// not the store's canvas sizes:
//
//   iphone         400 x 771  @4   1600 x 3084   kit v2.2's iPhone content area
//   pixel          400 x 805  @4   1600 x 3220   and its Pixel one
//   ipad           1376 x 1032 @2  2752 x 2064   a landscape tablet, as lastGLANCE's
//   ipad-portrait  1032 x 1376 @2  2064 x 2752   the same tablet, upright
//   mac            1680 x 1050 @2  3360 x 2100   dayGLANCE's desktop size, 16:10
//   mac-plain      the same, without the room the Mac app leaves for the
//                  window's traffic lights, for a frame that draws its own bar
//
// The data is the app's sample set, re-dated to today as always, made into
// real rows with a household around it, and with two changes for a store
// page: no product of another phone platform is named (Apple's rule for
// everything in a listing), and one plan has a fixed term so the page shows
// one. Nothing is read from or written to a real profile: each run is a fresh
// browser context. Uses the Chrome on this machine, as the end-to-end run does.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../store-assets/captures')
const APP = process.env.APP_URL ?? 'http://localhost:5190/'

const DEVICES = {
  iphone: { viewport: { width: 400, height: 771 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true },
  pixel: { viewport: { width: 400, height: 805 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true },
  ipad: { viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 2, hasTouch: true },
  'ipad-portrait': { viewport: { width: 1032, height: 1376 }, deviceScaleFactor: 2, hasTouch: true },
  mac: { viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2, classes: ['desktop', 'desktop-darwin'] },
  'mac-plain': { viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 },
}

const args = process.argv.slice(2)
const schemes = args.includes('both') ? ['dark', 'light'] : [args.find((a) => a === 'light' || a === 'dark') ?? 'dark']
const named = args.filter((a) => a in DEVICES)
const devices = named.length ? named : Object.keys(DEVICES)

// The household and its things, written straight into the page's own database.
async function seed(page) {
  await page.evaluate(async () => {
    const { buildSamples } = await import('/src/db/demo.ts')
    const { db } = await import('/src/db/client.ts')
    const q = await import('/src/db/queries.ts')
    const addMonths = (ymd, months) => {
      const [y, m, d] = ymd.split('-').map(Number)
      const at = new Date(Date.UTC(y, m - 1 + months, d))
      return at.toISOString().slice(0, 10)
    }

    const [alex, sam, riley] = [await q.addMember('Alex'), await q.addMember('Sam'), await q.addMember('Riley')]
    await q.attachThisDevice(alex.id, 'This device')

    const s = buildSamples()
    const real = ({ sample: _sample, ...row }) => row
    const owners = { 'MacBook Pro 14″': alex.id, 'iPhone 15 Pro': alex.id, 'iPad Air': riley.id, 'WH-1000XM5': sam.id, 'Kindle Paperwhite': sam.id }
    const things = s.things.map(real).map((t) => {
      // An out-of-support device that is not another platform's phone.
      const swapped = t.name === 'Pixel 6'
        ? { ...t, name: 'Kindle Paperwhite', category: 'tablet', brand: 'Amazon', model: '10th generation, 8 GB', retailer: 'Amazon', price: 129, notes: undefined }
        : t
      return { ...swapped, ownerMemberId: owners[swapped.name] ?? null, responsibleMemberId: owners[swapped.name] === alex.id ? alex.id : null }
    })
    const tv = things.find((t) => t.name.startsWith('LG C3'))
    const plans = s.subscriptions.map(real).map((p) => {
      if (p.name === 'YouTube Premium') return { ...p, name: 'Spotify Premium Family', provider: 'Spotify', amount: 19.99, coversHousehold: true, coversSet: true }
      if (p.name === 'iCloud+ 2 TB') return { ...p, payerMemberId: alex.id }
      return p
    })
    // A fixed term: paid monthly from the day the TV was bought, with six months left.
    const stamp = new Date().toISOString()
    plans.push({
      id: 'capture-plan-financing', kind: 'subscription', name: 'TV financing', provider: 'Best Buy', amount: 49.97, cycle: 'monthly',
      anchorDate: tv.purchaseDate, startDate: tv.purchaseDate, endDate: addMonths(tv.purchaseDate, 36),
      autoRenew: true, status: 'active', review: false, coversThingIds: [tv.id], coversMemberIds: [],
      payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp,
    })
    await db.things.bulkPut(things)
    await db.coverages.bulkPut(s.coverages.map(real))
    await db.subscriptions.bulkPut(plans)
    localStorage.setItem('tg_welcomed', '1')
  })
  await page.reload()
  await page.getByText('Needs a decision').first().waitFor()
}

// The tab that is on screen: the bar at the bottom of a phone, the header's
// row on anything wider. A tab's text may carry a count beside its name.
const tab = async (page, label) => {
  const found = await page.evaluate((name) => {
    const b = [...document.querySelectorAll('button')].find((el) => el.offsetParent !== null && el.textContent.replace(/[0-9]+/g, '').trim() === name)
    b?.click()
    return !!b
  }, label)
  if (!found) throw new Error(`no tab called ${label}`)
  await page.waitForTimeout(300)
  await page.evaluate(() => window.scrollTo(0, 0))
}
// Brings a heading to just under the app's header, whichever element scrolls.
const scrollTo = (page, heading) => page.evaluate((text) => {
  const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === text)
  if (!h) return
  const header = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 80
  const y = h.getBoundingClientRect().top + window.scrollY - header - 16
  ;(document.scrollingElement ?? document.documentElement).scrollTo(0, y)
  for (const el of document.querySelectorAll('*')) if (el.scrollHeight > el.clientHeight + 50 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = Math.max(el.scrollTop, y)
}, heading)
const openThing = async (page, name) => {
  const id = await page.evaluate(async (n) => (await (await import('/src/db/client.ts')).db.things.toArray()).find((t) => t.name === n)?.id, name)
  await page.evaluate((thingId) => window.__thingglance.openLink(`thingglance://thing/${thingId}`), id)
  await page.waitForTimeout(700)
}
const closeDrawers = async (page) => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) }

for (const scheme of schemes) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const device of devices) {
    const { classes = [], ...options } = DEVICES[device]
    const dir = `${OUT}/${device}`
    mkdirSync(dir, { recursive: true })
    const context = await browser.newContext({ ...options, colorScheme: scheme })
    // The Mac app marks the page so the header leaves room for the window's buttons.
    if (classes.length) await context.addInitScript((names) => document.documentElement.classList.add(...names), classes)
    const page = await context.newPage()
    await page.goto(APP)
    await page.getByText('Explore with sample data').waitFor()
    await seed(page)
    const save = async (name) => {
      // Off the page, so no row is caught in its hover state.
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1200)
      const file = `${dir}/${name}-${scheme}.png`
      await sharp(await page.screenshot({ type: 'png' })).removeAlpha().png().toFile(file)
      const meta = await sharp(file).metadata()
      console.log(`${device}/${name}-${scheme}  ${meta.width} x ${meta.height}`)
    }
    await save('1-glance')
    await scrollTo(page, 'Needs a decision')
    await save('2-decide')
    await tab(page, 'Horizon')
    await save('3-horizon')
    await tab(page, 'Things')
    await save('4-things')
    await tab(page, 'Plans')
    await save('5-plans')
    await tab(page, 'Things')
    await openThing(page, 'MacBook Pro 14″')
    await save('6-thing')
    await closeDrawers(page)
    await context.close()
  }
  await browser.close()
}
