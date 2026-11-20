// The Mac app's menu bar popup, captured from the app itself for the store
// set: the one screen scripts/store-captures.mjs cannot make, because it is a
// window of the desktop app and not a page a browser can open.
//
//   npm run dev                                  (in another terminal)
//   npm run build:electron:main
//   node scripts/store-capture-popup.mjs [dark|light|both]
//
// It starts the desktop app unpackaged, pointed at the dev server, on a
// profile of its own and a mock keychain (never the installed copy's), fills
// it with the same data the other captures use, opens the popup the way a
// click on the menu bar icon does, and saves it at four times its size:
// 380 x 560 becomes 1520 x 2240, written beside the other Mac captures.
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { seed } from './store-capture-data.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'store-assets/captures/mac')
const APP = process.env.APP_URL ?? 'http://localhost:5190'
const SCALE = 4
const args = process.argv.slice(2)
const schemes = args.includes('both') ? ['dark', 'light'] : [args.find((a) => a === 'light' || a === 'dark') ?? 'dark']
mkdirSync(OUT, { recursive: true })

for (const scheme of schemes) {
  const profile = mkdtempSync(join(os.tmpdir(), 'thingglance-capture-profile-'))
  const app = await electron.launch({
    args: [root, '--use-mock-keychain'],
    env: { ...process.env, VITE_DEV_SERVER_URL: APP, THINGGLANCE_USER_DATA_DIR: profile, THINGGLANCE_SMOKE_HOOKS: '1' },
    timeout: 60_000,
  })
  try {
    const page = await app.firstWindow()
    await page.getByText('Explore with sample data').waitFor({ timeout: 30_000 })
    // The app's own theme setting, which the popup reads from the storage the
    // two windows share: whatever this Mac's appearance happens to be.
    await page.evaluate(async (theme) => (await import('/src/state/settings.ts')).updateSettings({ theme }), scheme)
    await seed(page)
    // The popup draws what the main window has pushed to the main process.
    await page.waitForTimeout(1500)
    await app.evaluate(() => globalThis.__thingglanceSmoke.toggleTrayPopup())
    let popup = null
    for (let i = 0; i < 100 && !popup; i++) {
      if (i) await new Promise((r) => setTimeout(r, 100))
      popup = app.windows().find((w) => w.url().includes('tray=1')) ?? null
    }
    if (!popup) throw new Error('the popup did not open')
    await popup.getByRole('button', { name: 'Done with this' }).first().waitFor({ timeout: 15_000 })
    const size = await popup.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    // A Mac set to always show scroll bars draws one down the side; the popup
    // as most people see it has none until it is scrolled.
    await popup.addStyleTag({ content: '::-webkit-scrollbar { display: none }' })
    // Drawn at SCALE times its size, whatever this Mac's display is.
    const cdp = await popup.context().newCDPSession(popup)
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: SCALE, mobile: false })
    await popup.mouse.move(0, 0)
    await popup.waitForTimeout(800)
    // The popup hides itself the moment it loses focus, as it should, and a
    // hidden window draws no frame to capture: the capture would wait for
    // ever. It is shown again without being given focus, and a capture that
    // gets no frame fails here instead of hanging.
    const show = () => app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tray=1'))
      if (w && !w.isVisible()) w.showInactive()
    })
    const within = (ms, work, what) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error(`${what} got no answer in ${ms / 1000}s`)), ms))])
    const save = async (name) => {
      await show()
      await popup.waitForTimeout(600)
      const shot = await within(20_000, cdp.send('Page.captureScreenshot', { format: 'png' }), 'the capture')
      const file = join(OUT, `${name}-${scheme}.png`)
      await sharp(Buffer.from(shot.data, 'base64')).removeAlpha().png().toFile(file)
      const meta = await sharp(file).metadata()
      console.log(`mac/${name}-${scheme}  ${meta.width} x ${meta.height}  (popup is ${size.width} x ${size.height})`)
    }
    // As it opens, and scrolled to its end: the dates ahead and the charges.
    await save('7-menu-bar-popup')
    await popup.evaluate(() => { for (const el of [document.scrollingElement, ...document.querySelectorAll('*')]) if (el && el.scrollHeight > el.clientHeight + 20) el.scrollTop = el.scrollHeight })
    await save('8-menu-bar-popup-charges')
  } finally {
    await app.close().catch(() => {})
    rmSync(profile, { recursive: true, force: true })
  }
}
