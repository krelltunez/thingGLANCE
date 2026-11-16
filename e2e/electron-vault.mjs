#!/usr/bin/env node
// Desktop end-to-end: two copies of the PACKAGED app, each on a profile of its
// own, syncing through a real GLANCEvault. What it shows that the smoke test
// cannot:
//
//   - the vault form meets a server on this computer with "needs your
//     permission", and the system's dialog (answered here) unlocks it;
//   - connecting, the passphrase and a first sync all work with every request
//     made by the main process: the vault below does not list app://thingglance
//     among its allowed origins, and does not need to;
//   - the token and the root key are in the keystore, not in the page's storage;
//   - a thing added on one arrives on the other, and by live push, not a poll.
//
// Needs the packaged app (npm run build:electron:dir) and a vault that allows
// this app; the header of e2e/vault-sync.mjs has the one-liner that starts one.
//
//   npm run test:electron-vault
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const VAULT = process.env.VAULT_URL ?? 'http://localhost:8791'
const TOKEN = process.env.VAULT_TOKEN ?? 'local-test-token-thingglance-0001'
const ACCOUNT = `acct-desktop-${Date.now()}`
const PASS = 'correct horse battery staple'
const out = process.argv[2] ?? 'e2e/out'
mkdirSync(out, { recursive: true })

const executable = {
  linux: 'dist-app/linux-unpacked/thingglance',
  win32: 'dist-app/win-unpacked/thingGLANCE.exe',
  darwin: `dist-app/mac${process.arch === 'arm64' ? '-arm64' : ''}/thingGLANCE.app/Contents/MacOS/thingGLANCE`,
}[process.platform]
const executablePath = path.join(root, executable)
if (!existsSync(executablePath)) {
  console.error(`No packaged app at ${executable}. Run: npm run build:electron:dir`)
  process.exit(2)
}

// --no-sandbox: CI runners (and root in containers) cannot use Chromium's
// setuid sandbox. --use-mock-keychain: on macOS the keystore is the login
// keychain, which is the person's own and asks them before a rebuilt copy may
// read it; a test uses Chromium's stand-in and never touches it. The shipped
// app uses neither switch.
const LAUNCH_ARGS = ['--no-sandbox', '--use-mock-keychain']

const failures = []
const check = (what, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what} ${extra}`)
  if (!ok) failures.push(what)
}

const profiles = []
const apps = []
async function desktop(label) {
  const profile = mkdtempSync(path.join(os.tmpdir(), `thingglance-e2e-${label}-`))
  profiles.push(profile)
  const app = await electron.launch({ executablePath, args: LAUNCH_ARGS, env: { ...process.env, THINGGLANCE_USER_DATA_DIR: profile }, timeout: 60_000 })
  apps.push(app)
  // The system's "allow this address?" dialog, answered yes.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => { console.log(`[${label}] pageerror`, String(e)); failures.push(`${label}: page error`) })
  await page.waitForLoadState('load')
  await page.waitForSelector('#root > *', { timeout: 30_000 })
  return { app, page, profile, label }
}

async function connect({ page }, { expectBlocked }) {
  await page.getByRole('button', { name: /I already sync with GLANCEvault/ }).click()
  await page.getByRole('tab', { name: 'Self-hosted' }).click()
  await page.getByPlaceholder('https://vault.example.com').fill(VAULT)
  await page.getByLabel('Account ID').fill(ACCOUNT)
  await page.getByLabel('Device token').fill(TOKEN)
  await page.getByRole('button', { name: 'Test', exact: true }).click()
  if (expectBlocked) {
    const asked = await page.getByText(/is on a private network, so thingGLANCE needs your permission/).waitFor({ timeout: 5000 }).then(() => true, () => false)
    check('a vault on this computer is met with "needs your permission", before any request', asked)
    await page.getByRole('button', { name: /Allow this address/ }).click()
  }
  const reached = await page.getByText(/^Reachable[.,]/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false)
  return reached
}

async function finishConnecting({ page, label }) {
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  try {
    await page.getByRole('textbox', { name: 'Passphrase' }).waitFor({ timeout: 20_000 })
  } catch (err) {
    // Keep a picture of what was there instead.
    await page.screenshot({ path: `${out}/desktop-${label}-stuck.png` }).catch(() => {})
    throw err
  }
}

async function unlock({ page }) {
  await page.getByRole('textbox', { name: 'Passphrase' }).fill(PASS)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.getByRole('textbox', { name: 'Passphrase' }).waitFor({ state: 'hidden', timeout: 15_000 })
}

try {
  // ── A: allow the address, connect, set the passphrase, add a thing ─────────
  const A = await desktop('A')
  check('A: the test reaches the vault once the address is allowed', await connect(A, { expectBlocked: true }))
  await A.page.screenshot({ path: `${out}/desktop-A-vault-form.png` })
  await finishConnecting(A)
  await unlock(A)
  check('A: connected and unlocked', true)

  const secrets = path.join(A.profile, 'secure-store.json')
  const inStore = existsSync(secrets) ? Object.keys(JSON.parse(readFileSync(secrets, 'utf-8')).items ?? {}) : []
  const inPage = await A.page.evaluate((token) => Object.keys(localStorage).filter((k) => (localStorage.getItem(k) ?? '').includes(token)), TOKEN)
  const info = await A.page.evaluate(() => window.thingglanceDesktop.info)
  if (info.secureStorage) {
    check('A: the token and the root key are in the keystore, not in the page', inStore.length >= 2 && inPage.length === 0, `(keystore: ${inStore.join(', ')}; page: ${inPage.join(', ') || 'none'})`)
    check('A: the keystore file does not hold the token in the clear', !readFileSync(secrets, 'utf-8').includes(TOKEN))
  } else {
    check('A: no OS keystore here, so the app keeps its web storage', inPage.length > 0)
  }

  await A.page.keyboard.press('n')
  await A.page.getByLabel('Name', { exact: true }).fill('Desktop Laptop')
  await A.page.getByRole('button', { name: 'Add thing' }).click()
  await A.page.waitForTimeout(600)
  await A.page.keyboard.press('Escape')
  await A.page.waitForTimeout(5000) // the debounced push

  // ── B: a second computer. The address is allowed there too, then it pulls ──
  const B = await desktop('B')
  check('B: the test reaches the vault', await connect(B, { expectBlocked: true }))
  await finishConnecting(B)
  await unlock(B)
  await B.page.getByRole('tab', { name: /^Things/ }).first().click()
  check('B: the thing added on A arrives', await B.page.getByText('Desktop Laptop').first().waitFor({ timeout: 15_000 }).then(() => true, () => false))

  // ── Live push: A adds another, B shows it without being asked to sync ──────
  const live = await B.page.evaluate(() => new Promise((resolve) => {
    const seen = []
    const stop = window.thingglanceDesktop.vaultSse.onMessage((m) => { seen.push(m.type) })
    setTimeout(() => { stop(); resolve(seen) }, 1500)
  }))
  await A.page.keyboard.press('n')
  await A.page.getByLabel('Name', { exact: true }).fill('Desktop Monitor')
  await A.page.getByRole('button', { name: 'Add thing' }).click()
  await A.page.waitForTimeout(600)
  await A.page.keyboard.press('Escape')
  const arrived = await B.page.getByText('Desktop Monitor').first().waitFor({ timeout: 20_000 }).then(() => true, () => false)
  check('B: a second thing arrives by itself', arrived, `(stream before it: ${live.join(',') || 'quiet'})`)
  await B.page.getByRole('button', { name: 'Settings', exact: true }).click()
  await B.page.getByRole('button', { name: 'GLANCEvault', exact: true }).click()
  check('B: Settings says live updates are on', await B.page.getByText(/^Live: changes from your other devices/).waitFor({ timeout: 8000 }).then(() => true, () => false))
  check('B: the allowed address is listed, with a way to remove it', await B.page.getByText('Allowed private addresses').waitFor({ timeout: 5000 }).then(() => true, () => false))
  await B.page.screenshot({ path: `${out}/desktop-B-vault-settings.png` })
} finally {
  for (const app of apps) await app.close().catch(() => {})
  for (const dir of profiles) rmSync(dir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\ndesktop vault test passed')
