// End-to-end: two browser contexts ("devices") syncing through a real
// GLANCEvault, plus the shared roster, members and users (owner, responsible,
// private, the member filter, handing over and removing), a write and a link
// from outside the app, the dayGLANCE intent round-trip, and a third context
// standing in for a shell with its own network transport and keystore.
//
// Needs the dev server (npm run dev) and a vault that allows this app and this
// origin. A throwaway one from the sibling repo:
//
//   cd ../glance-vault && echo '{}' > /tmp/gv.json && \
//   GLANCEVAULT_CONFIG=/tmp/gv.json GLANCEVAULT_STORAGE_PATH=/tmp/gv.db \
//   GLANCEVAULT_BLOB_STORE_PATH=/tmp/gv-blobs GLANCEVAULT_PORT=8791 \
//   GLANCEVAULT_DEVICE_TOKEN=local-test-token-thingglance-0001 \
//   GLANCEVAULT_ALLOWED_ORIGINS=http://localhost:5190 \
//   GLANCEVAULT_ALLOWED_APPS=thingglance,glance-users,dayglance npx tsx src/index.ts
//
//   npm run test:e2e
//
// dayGLANCE itself is not in the loop: the script plays its part by reading
// the create intent off the vault and posting the notify dayGLANCE would send.
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import dayjs from 'dayjs'
import * as sync from '@glance-apps/sync'
import * as intents from '@glance-apps/intents'

const APP = process.env.APP_URL ?? 'http://localhost:5190/'
const VAULT = process.env.VAULT_URL ?? 'http://localhost:8791'
const TOKEN = process.env.VAULT_TOKEN ?? 'local-test-token-thingglance-0001'
const ACCOUNT = `acct-e2e-${Date.now()}`
const PASS = 'correct horse battery staple'
const out = process.argv[2] ?? 'e2e/out'
mkdirSync(out, { recursive: true })

const results = []
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(ok ? 'PASS' : 'FAIL', name, extra) }

const browser = await chromium.launch({ channel: 'chrome', headless: true })
async function device(label) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await ctx.addInitScript(() => { try { localStorage.setItem('tg_welcomed', '1') } catch {} })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${label}] pageerror`, String(e)))
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${label}] ${m.type()}:`, m.text().slice(0, 300)) })
  await page.goto(APP)
  await page.waitForTimeout(600)
  return page
}

async function connect(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'GLANCEvault', exact: true }).click()
  await page.getByRole('tab', { name: 'Self-hosted' }).click()
  await page.getByPlaceholder('https://vault.example.com').fill(VAULT)
  await page.getByLabel('Account ID').fill(ACCOUNT)
  await page.getByLabel('Device token').fill(TOKEN)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await page.waitForLoadState('load')
  await page.waitForTimeout(1500)
}
async function unlock(page, pass) {
  await page.getByRole('textbox', { name: 'Passphrase' }).fill(pass)
  await page.getByRole('button', { name: 'Unlock' }).click()
  await page.waitForTimeout(2500)
}
async function syncNow(page) {
  await page.keyboard.press('Meta+k')
  await page.getByPlaceholder(/Search things and plans/).fill('sync now')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
}
const goto = async (page, name) => {
  try {
    await page.getByRole('tab', { name: new RegExp(`^${name}`) }).first().click({ timeout: 8000 })
  } catch (err) {
    // Something is covering the page: keep a picture of what.
    await page.screenshot({ path: `${out}/e2e-stuck.png` }).catch(() => {})
    throw err
  }
  await page.waitForTimeout(500)
}

// ── Device A: connect, set the passphrase, add a thing ───────────────────────
const A = await device('A')
await connect(A)
check('A: passphrase prompt appears after connecting', await A.getByRole('textbox', { name: 'Passphrase' }).isVisible())
await unlock(A, PASS)
check('A: unlocked', !(await A.getByRole('textbox', { name: 'Passphrase' }).isVisible().catch(() => false)))

await A.keyboard.press('n')
await A.getByLabel('Name', { exact: true }).fill('E2E Laptop')
const bought = dayjs().subtract(1, 'year').add(10, 'day').format('YYYY-MM-DD')
await A.getByLabel('Bought on').fill(bought)
await A.getByLabel(/^Price/).fill('1500')
await A.getByRole('button', { name: 'Add thing' }).click()
await A.waitForTimeout(600)
await A.keyboard.press('Escape')
await A.waitForTimeout(5000) // debounced push
await A.screenshot({ path: `${out}/e2e-A-after-add.png` })

// ── Device B: wrong passphrase is refused, right one pulls the thing ─────────
const B = await device('B')
await connect(B)
await unlock(B, 'not the passphrase')
const mismatch = await B.getByText(/does not match this vault account/).isVisible().catch(() => false)
check('B: wrong passphrase is rejected', mismatch)
await unlock(B, PASS)
await B.waitForTimeout(2000)
await goto(B, 'Things')
check('B: thing created on A arrives', await B.getByText('E2E Laptop').first().isVisible().catch(() => false))
await goto(B, 'Glance')
check('B: its warranty arrives too (queue shows it)', await B.getByText('Manufacturer warranty ends').first().isVisible().catch(() => false))

// ── Edit on B, see it on A ───────────────────────────────────────────────────
await goto(B, 'Things')
await B.getByRole('button', { name: /E2E Laptop/ }).first().click()
await B.getByRole('button', { name: 'Edit' }).click()
await B.getByLabel('Name', { exact: true }).fill('E2E Laptop (renamed)')
await B.getByRole('button', { name: 'Save', exact: true }).click()
await B.waitForTimeout(700)
await B.keyboard.press('Escape')
await B.waitForTimeout(4500)
await syncNow(A)
await goto(A, 'Things')
check('A: edit made on B arrives', await A.getByText('E2E Laptop (renamed)').first().isVisible().catch(() => false))

// ── Live push: a change on A reaches B with nobody pressing sync ────────────
await goto(A, 'Plans')
await goto(B, 'Plans')
const liveB = await B.evaluate(() => window.__glanceVaultSse?.state)
check('B: event stream is open', liveB === 'open', `state=${liveB}`)
await A.keyboard.press('Meta+k')
await A.getByPlaceholder(/Search things and plans/).fill('add a plan')
await A.keyboard.press('Enter')
await A.getByLabel('Name', { exact: true }).fill('E2E Live Plan')
await A.getByLabel(/^Amount/).fill('4.99')
await A.getByRole('button', { name: 'Add plan' }).click()
// A pushes 3s after the write; B is nudged, debounces 400ms, then pulls.
let arrived = false
for (let i = 0; i < 20 && !arrived; i++) {
  await B.waitForTimeout(500)
  arrived = await B.getByRole('button', { name: /E2E Live Plan/ }).first().isVisible().catch(() => false)
}
const onA = await A.getByRole('button', { name: /E2E Live Plan/ }).first().isVisible().catch(() => false)
const diag = await B.evaluate(() => JSON.stringify(window.__glanceVaultSse))
check('B: change on A arrives on its own (live push)', arrived, arrived ? '' : `visibleOnA=${onA} sse=${diag}`)

// ── Household roster (glance-users) ──────────────────────────────────────────
const household = async (page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Household', exact: true }).click()
}
const addMember = async (page, name) => {
  await page.getByPlaceholder('Add a member').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
  await page.waitForTimeout(400)
}
await household(A)
// The first member added on an unclaimed device is taken to be its user;
// Casey is a member with no device at all.
await addMember(A, 'Alex')
await addMember(A, 'Casey')
check('A: the first member added is this device', await A.getByText('Uses the app: this device').isVisible().catch(() => false))
await A.waitForTimeout(4500)
await A.keyboard.press('Escape')
await household(B)
await B.waitForTimeout(3000)
// Scoped to the dialog: the header's member filter also lists every name.
check('B: member added on A arrives through glance-users', await B.getByRole('dialog').getByText('Alex').first().isVisible().catch(() => false))
check('B: sees that Alex uses the app (the device link synced)', await B.getByText(/Uses the app: .*Chrome on/).first().isVisible().catch(() => false))
check('B: Casey is a member without a device', (await B.getByText('Does not use the app').count()) === 1)

// ── Members and users: owner, responsible, private ──────────────────────────
await addMember(B, 'Blake')
await B.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Blake' }).getByRole('button', { name: 'This is me' }).click()
await B.waitForTimeout(4500)
await B.screenshot({ path: `${out}/e2e-B-household.png` })
await B.keyboard.press('Escape')

const editLaptop = async (page) => {
  await goto(page, 'Things')
  await page.getByRole('button', { name: /E2E Laptop/ }).first().click()
  await page.getByRole('button', { name: 'Edit' }).click()
  return page.getByRole('dialog').last()
}
const saveLaptop = async (page, form) => {
  await form.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForTimeout(700)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(4500) // debounced push
}
await syncNow(A)
let form = await editLaptop(A)
await form.getByRole('button', { name: 'Blake', exact: true }).click()
const pickable = await form.getByLabel('Who deals with it?').locator('option').allTextContents()
check('A: only members with a device can be responsible', pickable.includes('Blake') && pickable.some((o) => o.startsWith('Alex')) && !pickable.includes('Casey'), pickable.join(' | '))
await form.getByLabel('Who deals with it?').selectOption({ label: 'Blake' })
await saveLaptop(A, form)
await syncNow(B)
await goto(B, 'Things')
check('B: owner set on A arrives', await B.getByRole('button', { name: /E2E Laptop.*Blake|Blake.*E2E Laptop/s }).first().isVisible().catch(() => false))

// Private to Alex (A's member): B belongs to Blake, so it disappears there.
form = await editLaptop(A)
await form.getByRole('button', { name: 'Alex', exact: true }).click()
await form.getByText('Private', { exact: true }).click()
await saveLaptop(A, form)
await syncNow(B)
await goto(B, 'Things')
check('B: a thing private to someone else is hidden', !(await B.getByText('E2E Laptop').first().isVisible().catch(() => false)))
await goto(A, 'Things')
check('A: its owner still sees it', await A.getByText('E2E Laptop').first().isVisible().catch(() => false))
form = await editLaptop(A)
await form.getByText('Private', { exact: true }).click()
await saveLaptop(A, form)
await syncNow(B)
await goto(B, 'Things')
check('B: shared again, it comes back', await B.getByText('E2E Laptop').first().isVisible().catch(() => false))

// The member filter. The laptop is Alex's and Blake deals with it, so it has
// nothing to do with Casey.
const filter = B.getByLabel('Whose things to show')
await filter.selectOption({ label: 'Casey' })
await B.waitForTimeout(500)
check('B: filtered to Casey, a thing that is not theirs drops out', !(await B.getByText('E2E Laptop').first().isVisible().catch(() => false)))
await filter.selectOption({ label: 'Blake (me)' })
await B.waitForTimeout(500)
check('B: filtered to the member who deals with it, it shows', await B.getByText('E2E Laptop').first().isVisible().catch(() => false))
await filter.selectOption({ label: 'Everyone' })

// Removing a member who still owns something: hand it over, then remove.
form = await editLaptop(A)
await form.getByRole('button', { name: 'Casey', exact: true }).click()
await saveLaptop(A, form)
await household(A)
const caseyRow = A.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Casey' })
await caseyRow.getByTitle('Remove').click()
await A.waitForTimeout(400)
check('A: removing a member who owns a thing asks who gets it', await caseyRow.getByText(/Casey still owns 1 thing/).isVisible().catch(() => false))
await caseyRow.getByLabel('Who gets what Casey has').selectOption({ label: 'Blake' })
await caseyRow.getByRole('button', { name: 'Hand over and remove' }).click()
await A.waitForTimeout(4500)
check('A: Casey is gone from the list', (await A.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Casey' }).count()) === 0)
await A.keyboard.press('Escape')
await syncNow(B)
await goto(B, 'Things')
check('B: the hand-over arrives, the laptop is Blake\'s', await B.getByRole('button', { name: /E2E Laptop.*Blake|Blake.*E2E Laptop/s }).first().isVisible().catch(() => false))

// ── The two doors in from outside: a write, and a link ──────────────────────
// No shell exists yet, so the dev server exposes both on window.__thingglance.
const outsideId = crypto.randomUUID()
const outsideWrite = { action: 'create_thing', clientId: outsideId, payload: { name: 'E2E Outside Write', price: 42 } }
const landed = await A.evaluate((w) => window.__thingglance.intent(w), outsideWrite)
const resent = await A.evaluate((w) => window.__thingglance.intent(w), outsideWrite)
check('A: a write from outside lands, and re-sending it changes nothing', landed.success && landed.thing_id === outsideId && resent.deduped === true, JSON.stringify(resent))
check('A: a write with no id is refused', (await A.evaluate(() => window.__thingglance.intent({ action: 'create_thing', payload: { name: 'No id' } }))).code === 'client_id_required')
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
await goto(B, 'Things')
check('B: the outside write syncs like any other', (await B.getByText('E2E Outside Write').count()) === 1)
await B.evaluate((id) => window.__thingglance.openLink(`thingglance://thing/${id}`), outsideId)
await B.waitForTimeout(600)
check('B: a link opens the thing it names', (await B.getByText('E2E Outside Write').count()) >= 2)
await B.keyboard.press('Escape')
await B.waitForTimeout(300)

// ── Intents: send to dayGLANCE, then play dayGLANCE's reply ──────────────────
await A.getByRole('button', { name: 'Settings', exact: true }).click()
await A.getByRole('button', { name: 'Integrations', exact: true }).click()
await A.getByRole('switch').first().click()
await A.waitForTimeout(800)
await A.keyboard.press('Escape')
await goto(A, 'Glance')
await A.getByTitle('Send to dayGLANCE as a task').first().click()
await A.waitForTimeout(2500)
check('A: item shows as sent', await A.getByText('In dayGLANCE').first().isVisible().catch(() => false))
await A.screenshot({ path: `${out}/e2e-A-sent.png` })

// Read what landed on the vault, as dayGLANCE would: same passphrase + salt.
const client = sync.createVaultClient({ vaultUrl: VAULT, vaultToken: TOKEN, brake: false })
const salt = await client.getSalt(ACCOUNT)
const rootKey = await intents.deriveIntentsRootKey(PASS, new Uint8Array(salt))
const deriveKey = (s) => intents.deriveEnvelopeKey(rootKey, s)
const listed = await client.intentsList(ACCOUNT, { since: 0 })
const row = intents.parseIntentRow(listed.rows[listed.rows.length - 1])
check('vault: the intent row is encrypted', row.envelope.encrypted === true)
const env = await intents.parseEncryptedEnvelope(row.envelope, deriveKey)
console.log('  create payload:', JSON.stringify(env.payload))
check('vault: the task is assigned to whoever deals with the thing', Array.isArray(env.payload.assigned_user_ids) && env.payload.assigned_user_ids.length === 1)
check('vault: decrypts to a create from app.thingglance', env.action === 'create' && env.payload.source_app === 'app.thingglance' && !!env.payload.source_entity_id && /^\d{4}-\d{2}-\d{2}$/.test(env.payload.due))

const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const notify = await intents.buildEncryptedEnvelope({
  action: 'notify', emittedBy: 'app.dayglance',
  payload: { event_id: intents.eventId(), source_app: 'app.thingglance', source_entity_id: env.payload.source_entity_id, event: 'completed', task_id: 'tsk_e2e', title: env.payload.title, timestamp: now, completed_at: now },
}, deriveKey)
await client.intentsBatch(ACCOUNT, [intents.buildIntentRow(notify, { ttlMs: 86_400_000 })])
await syncNow(A)
await A.waitForTimeout(1500)
check('A: completing the task in dayGLANCE clears the item', await A.getByText('Recently cleared').isVisible().catch(() => false) && !(await A.getByText('In dayGLANCE').first().isVisible().catch(() => false)))
await A.screenshot({ path: `${out}/e2e-A-cleared.png` })
await syncNow(B)
await goto(B, 'Glance')
check('B: the cleared decision syncs to the other device', !(await B.getByText('Manufacturer warranty ends').first().isVisible().catch(() => false)) || await B.getByText('Recently cleared').isVisible().catch(() => false))

// ── Delete on A, gone on B ───────────────────────────────────────────────────
await goto(A, 'Things')
await A.getByRole('button', { name: /E2E Laptop/ }).first().click()
await A.getByRole('button', { name: 'Delete', exact: true }).click()
await A.getByRole('button', { name: 'Delete for good' }).click()
await A.waitForTimeout(4500)
await syncNow(B)
await goto(B, 'Things')
check('B: delete made on A arrives', !(await B.getByText('E2E Laptop').first().isVisible().catch(() => false)))

// ── Device C: the same bundle inside a shell ─────────────────────────────────
// A stand-in for a Capacitor or Electron shell (docs/shells.md): it supplies
// its own network transport and a keystore before the app boots. The keystore
// here is sessionStorage under a prefix, which survives the reload a
// connection change ends in. The platform fetch is wrapped to count any vault
// request that did not come through the shell's transport; the live event
// stream is the one request allowed to.
const shellCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
await shellCtx.addInitScript((vault) => {
  try { localStorage.setItem('tg_welcomed', '1') } catch {}
  const real = window.fetch.bind(window)
  const url = (input) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  window.__seam = { viaShell: 0, bypassed: [] }
  let inShell = false
  window.fetch = (input, init) => {
    const u = url(input)
    if (u.startsWith(vault) && !inShell && !u.includes('/events')) window.__seam.bypassed.push(u.slice(vault.length))
    return real(input, init)
  }
  const key = (k) => `keystore:${k}`
  window.thingglanceShell = {
    fetch: (input, init) => {
      window.__seam.viaShell += 1
      inShell = true
      try { return real(input, init) } finally { inShell = false }
    },
    secureStore: {
      get: async (k) => sessionStorage.getItem(key(k)),
      set: async (k, v) => { sessionStorage.setItem(key(k), v) },
      remove: async (k) => { sessionStorage.removeItem(key(k)) },
    },
  }
}, VAULT)
const C = await shellCtx.newPage()
C.on('pageerror', (e) => console.log('[C] pageerror', String(e)))
await C.goto(APP)
await C.waitForTimeout(600)
await connect(C)
await unlock(C, PASS)
await C.waitForTimeout(2500)
const seam = await C.evaluate(async (token) => {
  const plain = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n')
  const dbs = (await indexedDB.databases()).map((d) => d.name)
  return {
    viaShell: window.__seam.viaShell,
    bypassed: window.__seam.bypassed,
    tokenInLocalStorage: plain.includes(token),
    configInLocalStorage: localStorage.getItem('thingglance-vault-config') !== null,
    configInKeystore: (sessionStorage.getItem('keystore:thingglance-vault-config') ?? '').includes(token),
    rootKeyInKeystore: sessionStorage.getItem('keystore:crypto.db-root-key') !== null,
    rootKeyDatabase: dbs.filter((n) => n && n.startsWith('thingglance-crypto')),
  }
}, TOKEN)
check('C (shell): every vault request went out on the shell\'s transport', seam.viaShell > 0 && seam.bypassed.length === 0, `via shell ${seam.viaShell}, bypassed ${JSON.stringify(seam.bypassed)}`)
check('C (shell): the vault token is in the keystore and not in localStorage', seam.configInKeystore && !seam.tokenInLocalStorage && !seam.configInLocalStorage)
check('C (shell): the root key is in the keystore and not in IndexedDB', seam.rootKeyInKeystore && seam.rootKeyDatabase.length === 0, JSON.stringify(seam.rootKeyDatabase))
await C.reload()
await C.waitForTimeout(3000)
check('C (shell): after a reload it is still connected and asks for no passphrase', !(await C.getByRole('textbox', { name: 'Passphrase' }).isVisible().catch(() => false)) && await C.getByRole('button', { name: /Synced|Up to date|Sync/ }).first().isVisible().catch(() => false))
await goto(C, 'Things')
check('C (shell): it syncs like any other device', await C.getByText('E2E Outside Write').first().isVisible().catch(() => false))

console.log('\n' + results.map((r) => r.join('  ')).join('\n'))
await browser.close()
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
