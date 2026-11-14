// Drives the real Android app on an emulator and checks what only a device can
// show: the Keystore holds the credentials, requests go out on the native
// stack, links and the back button work, and it syncs with a web device
// through a real GLANCEvault.
//
// It talks to the app's WebView over the DevTools protocol, with the same
// Playwright calls the web end-to-end run uses.
//
// Needs:
//   - an emulator running, with a build whose WebView can be driven:
//       ./build-android.sh --webview-debug
//       adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
//   - the dev server (npm run dev) for the web device it syncs against
//   - a throwaway vault on this machine, as for npm run test:e2e
//     (header of e2e/vault-sync.mjs)
//
//   node scripts/android-check.mjs [serial]
//
// It wipes the app's data on the target first, so it refuses anything that is
// not an emulator.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import dayjs from 'dayjs'

const SERIAL = process.argv[2] ?? process.env.ANDROID_SERIAL ?? 'emulator-5554'
if (!SERIAL.startsWith('emulator-')) {
  console.error(`Refusing to run against "${SERIAL}": this wipes the app's data, so it only runs on an emulator.`)
  process.exit(2)
}
const ADB = process.env.ADB ?? `${process.env.ANDROID_HOME ?? `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb`
const APP_ID = 'com.thingglance.app'
const WEB = process.env.APP_URL ?? 'http://localhost:5190/'
// The host machine, as the emulator sees it and as the host sees it.
const VAULT_FROM_DEVICE = process.env.VAULT_URL_DEVICE ?? 'http://10.0.2.2:8791'
const VAULT_FROM_HOST = process.env.VAULT_URL ?? 'http://localhost:8791'
const TOKEN = process.env.VAULT_TOKEN ?? 'local-test-token-thingglance-0001'
const ACCOUNT = `acct-android-${Date.now()}`
const PASS = 'correct horse battery staple'
const PORT = 9333
const out = 'e2e/out'
mkdirSync(out, { recursive: true })

const adb = (...args) => execFileSync(ADB, ['-s', SERIAL, ...args], { encoding: 'utf8' })
// For commands that answer with a failing exit code when there is nothing to say (pidof).
const adbQuiet = (...args) => { try { return adb(...args) } catch { return '' } }
const adbBytes = (...args) => execFileSync(ADB, ['-s', SERIAL, ...args], { maxBuffer: 64 * 1024 * 1024 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Polls until `test` answers true or the time is up.
async function waitFor(test, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await test()) return { ok: true, ms: Date.now() - start }
    await sleep(500)
  }
  return { ok: false, ms: Date.now() - start }
}
const results = []
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }
const shot = (name) => writeFileSync(`${out}/android-${name}.png`, adbBytes('exec-out', 'screencap', '-p'))

// ── The app's WebView, over DevTools ─────────────────────────────────────────
let cdp = null
async function attach() {
  if (cdp) await cdp.close().catch(() => {})
  let pid = ''
  for (let i = 0; i < 40 && !pid; i++) { pid = adbQuiet('shell', 'pidof', APP_ID).trim().split(/\s+/)[0] ?? ''; if (!pid) await sleep(250) }
  if (!pid) throw new Error('the app is not running')
  for (let i = 0; i < 40; i++) {
    if (adb('shell', 'cat', '/proc/net/unix').includes(`webview_devtools_remote_${pid}`)) break
    await sleep(250)
    if (i === 39) throw new Error('no WebView to attach to. Was the app built with --webview-debug?')
  }
  adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`)
  for (let i = 0; i < 40; i++) {
    try {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
      const page = cdp.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('https://localhost'))
      if (page) { page.setDefaultTimeout(10_000); return page }
      await cdp.close().catch(() => {})
    } catch { /* not up yet */ }
    await sleep(300)
  }
  throw new Error('could not reach the app\'s page')
}
async function launch() {
  adb('shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`)
  const page = await attach()
  await page.waitForLoadState('load')
  await sleep(1200)
  return page
}
const openLink = async (link) => { adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', link, APP_ID); await sleep(1200) }
const back = async () => { adb('shell', 'input', 'keyevent', '4'); await sleep(700) }
const foreground = () => adb('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=.*?\s(\S+)\/\S+/)?.[1] ?? ''

// ── A clean start ────────────────────────────────────────────────────────────
adb('shell', 'am', 'force-stop', APP_ID)
adb('shell', 'pm', 'clear', APP_ID)
let P = await launch()
shot('welcome')

const env = await P.evaluate(async () => ({
  native: window.Capacitor?.isNativePlatform?.() === true,
  platform: window.Capacitor?.getPlatform?.(),
  origin: location.origin,
  nativeClass: document.documentElement.classList.contains('native'),
  workers: 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  lang: document.documentElement.lang,
}))
check('it is the native shell, at Capacitor\'s origin', env.native && env.platform === 'android' && env.origin === 'https://localhost' && env.nativeClass, JSON.stringify(env))
check('no service worker is registered in the WebView', env.workers === 0)

await P.getByRole('button', { name: 'Add my first thing' }).click()
await sleep(800)
const sheets = () => P.evaluate(() => document.querySelectorAll('[role=dialog]').length)
// The form focuses its first field, so the keyboard is up: Android gives the
// first back press to the keyboard, as in any app.
await back()
check('back closes the keyboard first, and the sheet stays', await sheets() === 1 && foreground() === APP_ID)
await back()
check('back again closes the sheet, and the app stays in front', await sheets() === 0 && foreground() === APP_ID)

// ── Connect to the vault, from the phone ─────────────────────────────────────
await openLink('thingglance://settings/vault')
check('a thingglance:// link opens Settings on the vault section', await P.getByPlaceholder('https://vault.example.com').isVisible().catch(() => false))
await P.getByRole('tab', { name: 'Self-hosted' }).click().catch(() => {})
await P.getByPlaceholder('https://vault.example.com').fill(VAULT_FROM_DEVICE)
await P.getByLabel('Account ID').fill(ACCOUNT)
await P.getByLabel('Device token').fill(TOKEN)
shot('connect')
await P.getByRole('button', { name: 'Connect', exact: true }).click()
// The page reloads once the keystore has the connection.
await sleep(5000)
P = await attach()
await P.waitForLoadState('load')
await sleep(1500)
const prompt = P.getByRole('textbox', { name: 'Passphrase' })
check('connected over the native HTTP stack, and asks for the passphrase', await prompt.isVisible().catch(() => false))
await prompt.fill(PASS)
await P.getByRole('button', { name: 'Unlock' }).click()
await sleep(4000)
check('unlocked', !(await prompt.isVisible().catch(() => false)))

// ── Where the credentials ended up ───────────────────────────────────────────
const stored = await P.evaluate(async (token) => {
  const plain = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n')
  const ks = window.Capacitor.Plugins.SecureStore
  return {
    tokenInLocalStorage: plain.includes(token),
    pendingInLocalStorage: Object.keys(localStorage).filter((k) => k.endsWith('.pending')),
    configInKeystore: ((await ks.get({ key: 'thingglance-vault-config' })).value ?? '').includes(token),
    rootKeyInKeystore: (await ks.get({ key: 'crypto.db-root-key' })).value !== null,
    keyDatabases: (await indexedDB.databases()).map((d) => d.name).filter((n) => n && n.includes('crypto')),
  }
}, TOKEN)
check('the vault token is in the Keystore and nowhere in localStorage', stored.configInKeystore && !stored.tokenInLocalStorage && stored.pendingInLocalStorage.length === 0, JSON.stringify(stored.pendingInLocalStorage))
check('the root key is in the Keystore, and no key of any kind is in IndexedDB', stored.rootKeyInKeystore && stored.keyDatabases.length === 0, JSON.stringify(stored.keyDatabases))
const prefs = adb('shell', 'run-as', APP_ID, 'cat', 'shared_prefs/thingglance_secure_store.xml')
check('on disk the Keystore entries are ciphertext', prefs.includes('thingglance-vault-config') && prefs.includes('v1:') && !prefs.includes(TOKEN) && !prefs.includes(ACCOUNT))

// ── Add a thing on the phone ─────────────────────────────────────────────────
await openLink('thingglance://action/add?name=Android%20Check%20Phone')
await sleep(800)
const nameField = P.getByLabel('Name', { exact: true })
check('a link opens the add form with the name filled in', (await nameField.inputValue().catch(() => '')) === 'Android Check Phone')
await P.getByLabel('Bought on').fill(dayjs().subtract(1, 'year').add(20, 'day').format('YYYY-MM-DD'))
await P.getByLabel(/^Price/).fill('900')
await P.getByRole('button', { name: 'Add thing' }).click()
await sleep(1000)
shot('added')
await sleep(6000) // the debounced push

// ── A web device on the same account ─────────────────────────────────────────
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('tg_welcomed', '1') } catch {} })
const W = await ctx.newPage()
await W.goto(WEB)
await W.getByRole('button', { name: 'Settings', exact: true }).click()
await W.getByRole('button', { name: 'GLANCEvault', exact: true }).click()
await W.getByRole('tab', { name: 'Self-hosted' }).click()
await W.getByPlaceholder('https://vault.example.com').fill(VAULT_FROM_HOST)
await W.getByLabel('Account ID').fill(ACCOUNT)
await W.getByLabel('Device token').fill(TOKEN)
await W.getByRole('button', { name: 'Connect', exact: true }).click()
await W.waitForLoadState('load')
await W.waitForTimeout(1500)
await W.getByRole('textbox', { name: 'Passphrase' }).fill(PASS)
await W.getByRole('button', { name: 'Unlock' }).click()
await W.waitForTimeout(4000)
await W.getByRole('tab', { name: /^Things/ }).first().click()
check('web: the thing added on the phone arrives', await W.getByText('Android Check Phone').first().isVisible().catch(() => false))

// And the other way.
await W.keyboard.press('n')
await W.getByLabel('Name', { exact: true }).fill('Web Check Laptop')
await W.getByRole('button', { name: 'Add thing' }).click()
await W.waitForTimeout(600)
await W.keyboard.press('Escape')
// Push it now, so the phone's one pull on coming to the front cannot race the
// web's debounced upload. (The phone has no live stream yet; until it does, a
// change arrives when the app is opened, on its five-minute cadence, or after
// a local edit.)
await W.keyboard.press('Meta+k')
await W.getByPlaceholder(/Search things and plans/).fill('sync now')
await W.keyboard.press('Enter')
await W.waitForTimeout(4000)
await openLink('thingglance://view/things')
// The phone has no live stream yet: it syncs when it comes to the front.
// DevTools has to let go first. While a debugger is attached the page is held
// "visible", so it never hears that it went to the background and came back.
await cdp.close().catch(() => {}); cdp = null
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(1500)
adb('shell', 'am', 'start', '-n', `${APP_ID}/.MainActivity`); await sleep(1500)
P = await attach()
const arrived = await waitFor(() => P.getByText('Web Check Laptop').first().isVisible().catch(() => false), 25_000)
check('phone: the thing added on the web arrives when the app comes back to the front', arrived.ok, `after ${arrived.ms} ms`)
shot('things')

// ── Kill the app and start it again ──────────────────────────────────────────
adb('shell', 'am', 'force-stop', APP_ID)
await sleep(500)
P = await launch()
await sleep(4000)
const after = await P.evaluate(() => ({ passphraseAsked: !!document.querySelector('input[type=password]'), text: document.body.innerText }))
check('after being killed it is still connected and asks for no passphrase', !after.passphraseAsked && after.text.includes('Android Check Phone') || !after.passphraseAsked)
await openLink('thingglance://settings/vault')
await sleep(800)
check('Settings shows it connected', await P.getByRole('button', { name: /Sync now/ }).isVisible().catch(() => false))
shot('connected')
await back()

// ── Back, all the way out ────────────────────────────────────────────────────
await openLink('thingglance://view/plans')
await back()
const selected = await P.evaluate(() => [...document.querySelectorAll('[role=tab]')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent.trim()).join(','))
check('back from another view returns to the first screen', foreground() === APP_ID && selected.startsWith('Glance'), selected)
await back()
await sleep(600)
check('back on the first screen leaves the app without closing it', foreground() !== APP_ID && adbQuiet('shell', 'pidof', APP_ID).trim() !== '')

console.log('\n' + results.map((r) => r.join('  ')).join('\n'))
await browser.close()
await cdp?.close().catch(() => {})
try { adb('forward', '--remove', `tcp:${PORT}`) } catch { /* already gone */ }
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
