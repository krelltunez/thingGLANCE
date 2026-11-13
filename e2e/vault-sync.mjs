// End-to-end: two browser contexts ("devices") syncing through a real
// GLANCEvault, plus the shared roster and the dayGLANCE intent round-trip.
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
const goto = async (page, name) => { await page.getByRole('tab', { name: new RegExp(`^${name}`) }).first().click(); await page.waitForTimeout(500) }

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

// ── Household roster (glance-users) ──────────────────────────────────────────
const household = async (page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Household', exact: true }).click()
  await page.getByRole('switch').first().click()
}
await household(A)
await A.getByPlaceholder('Add a member').fill('Alex')
await A.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click()
await A.waitForTimeout(4500)
await A.keyboard.press('Escape')
await household(B)
await B.waitForTimeout(3000)
check('B: member added on A arrives through glance-users', await B.getByText('Alex').first().isVisible().catch(() => false))
await B.screenshot({ path: `${out}/e2e-B-household.png` })
await B.keyboard.press('Escape')

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

console.log('\n' + results.map((r) => r.join('  ')).join('\n'))
await browser.close()
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
