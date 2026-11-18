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

// A plan with a beginning and an end (a lease). Both dates cross the vault,
// and an edit on the other device that names neither leaves them as they were:
// a row is laid over what is stored, never rebuilt from the fields a form knows.
// (The edit is one that keeps the plan out of the queue: the dayGLANCE part
// below sends the queue's first date.)
const leaseId = crypto.randomUUID()
const leaseWrite = { action: 'create_plan', clientId: leaseId, payload: { name: 'E2E Lease', amount: 75.17, start_date: '2026-09-22', end_date: '2029-09-22' } }
const planRow = (page) => page.evaluate(async (id) => (await import('/src/db/client.ts')).db.subscriptions.get(id), leaseId)
check('A: a plan from outside takes a start and an end', (await A.evaluate((w) => window.__thingglance.intent(w), leaseWrite)).plan_id === leaseId)
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
const leaseOnB = await planRow(B)
check('B: the plan arrives with both dates', leaseOnB?.startDate === '2026-09-22' && leaseOnB?.endDate === '2029-09-22' && leaseOnB?.autoRenew === true, JSON.stringify(leaseOnB ?? null))
await B.evaluate(async (id) => (await import('/src/db/queries.ts')).patchSubscription(id, { notes: 'Edited on B' }), leaseId)
await B.waitForTimeout(4500)
await syncNow(A)
const leaseOnA = await planRow(A)
check('A: an edit on B that names neither date leaves both', leaseOnA?.notes === 'Edited on B' && leaseOnA?.startDate === '2026-09-22' && leaseOnA?.endDate === '2029-09-22', JSON.stringify(leaseOnA ?? null))
await goto(A, 'Plans')
check('A: the plans page says when the term ends', await A.getByText(/ends Sep 2029/).first().isVisible().catch(() => false))

// A start has three states: a date, "started before I tracked it" (an answer)
// and nothing yet. In the form the date and the box never stand together, and
// each state reaches the other device as it was left.
await A.getByRole('button', { name: /E2E Lease/ }).first().click()
await A.waitForTimeout(400)
const planForm = A.getByRole('dialog').last()
const startBox = planForm.getByLabel('Started before I tracked it')
const startField = planForm.locator('[data-plan-start]')
const shown = { date: await startField.inputValue(), box: await startBox.isChecked() }
await startBox.check()
const ticked = { date: await startField.inputValue(), box: await startBox.isChecked() }
await startField.fill('2026-10-01')
const dated = { date: await startField.inputValue(), box: await startBox.isChecked() }
await startBox.check()
check('A: ticking "Started before I tracked it" clears the date, and a date unticks it',
  shown.date === '2026-09-22' && !shown.box && ticked.date === '' && ticked.box && dated.date === '2026-10-01' && !dated.box && (await startField.inputValue()) === '',
  JSON.stringify({ shown, ticked, dated }))
await planForm.getByRole('button', { name: 'Save', exact: true }).click()
await A.waitForTimeout(700)
const unansweredId = crypto.randomUUID()
await A.evaluate((w) => window.__thingglance.intent(w), { action: 'create_plan', clientId: unansweredId, payload: { name: 'E2E Unanswered', amount: 3 } })
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
const startOf = (page, id) => page.evaluate(async (planId) => {
  const row = await (await import('/src/db/client.ts')).db.subscriptions.get(planId)
  return row ? { status: (await import('/src/core/money.ts')).startStatus(row), startDate: row.startDate ?? null, startUnknown: row.startUnknown ?? null } : null
}, id)
const unknownOnB = await startOf(B, leaseId)
check('B: "started before I tracked it" arrives as that, with no date', unknownOnB?.status === 'unknown' && unknownOnB.startDate === null && unknownOnB.startUnknown === true, JSON.stringify(unknownOnB))
const unansweredOnB = await startOf(B, unansweredId)
check('B: a plan nobody answered for arrives unanswered', unansweredOnB?.status === 'not_set' && unansweredOnB.startDate === null && unansweredOnB.startUnknown === null, JSON.stringify(unansweredOnB))
// And a date given on the other device settles it everywhere.
await B.evaluate(async (id) => (await import('/src/db/queries.ts')).patchSubscription(id, { startDate: '2026-09-22' }), leaseId)
await B.waitForTimeout(4500)
await syncNow(A)
const settledOnA = await startOf(A, leaseId)
check('A: a date given on B replaces "unknown"', settledOnA?.status === 'recorded' && settledOnA.startDate === '2026-09-22' && settledOnA.startUnknown === null, JSON.stringify(settledOnA))

// Who a plan is used by: people, the household as a whole, or nobody has
// said. In the form the household and names never stand together, and what
// is saved reaches the other device as the household in all three places a
// plan can name it (who pays, who deals with it, who uses it).
await A.evaluate((id) => window.__thingglance.openLink(`thingglance://plan/${id}`), unansweredId)
await A.waitForTimeout(600)
const usedBy = A.getByRole('dialog').last().locator('[data-used-by]')
const pressed = async (name) => (await usedBy.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true'
const unsaid = !(await pressed('Household')) && !(await pressed('Blake'))
await usedBy.getByRole('button', { name: 'Household', exact: true }).click()
const householdOn = (await pressed('Household')) && !(await pressed('Blake'))
await usedBy.getByRole('button', { name: 'Blake', exact: true }).click()
const blakeOn = !(await pressed('Household')) && (await pressed('Blake'))
await usedBy.getByRole('button', { name: 'Household', exact: true }).click()
check('A: "Household" and a member\'s name never stand together in "Who is it for?"', unsaid && householdOn && blakeOn && (await pressed('Household')) && !(await pressed('Blake')), JSON.stringify({ unsaid, householdOn, blakeOn }))
await A.getByRole('dialog').last().getByRole('button', { name: 'Save', exact: true }).click()
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
const whoOf = (page, id) => page.evaluate(async (planId) => {
  const row = await (await import('/src/db/client.ts')).db.subscriptions.get(planId)
  const { holderOf, usedBy: used } = await import('/src/core/household.ts')
  return row ? { payer: holderOf(row.payerMemberId), responsible: holderOf(row.responsibleMemberId), usedBy: used(row), members: row.coversMemberIds, flag: row.coversHousehold ?? null } : null
}, id)
const householdOnB = await whoOf(B, unansweredId)
check('B: the household arrives as the household, for who pays, who deals with it and who uses it',
  householdOnB?.payer === 'household' && householdOnB.responsible === 'household' && householdOnB.usedBy === 'household' && householdOnB.flag === true && householdOnB.members.length === 0, JSON.stringify(householdOnB))
const unsaidOnB = await whoOf(B, leaseId)
check('B: a plan nobody was named on stays "not set", not the household', unsaidOnB?.usedBy === 'not_set' && unsaidOnB.flag === null, JSON.stringify(unsaidOnB))
// Naming someone on the other device takes the household's place everywhere.
const blakeId = await B.evaluate(async () => (await (await import('/src/db/client.ts')).db.members.toArray()).find((m) => m.name === 'Blake')?.id)
await B.evaluate(async ([id, member]) => (await import('/src/db/queries.ts')).patchSubscription(id, { coversMemberIds: [member], payerMemberId: member, responsibleMemberId: member }), [unansweredId, blakeId])
await B.waitForTimeout(4500)
await syncNow(A)
const namedOnA = await whoOf(A, unansweredId)
check('A: a member named on B replaces the household in all three', namedOnA?.payer === 'member' && namedOnA.responsible === 'member' && namedOnA.usedBy === 'members' && namedOnA.flag === null && namedOnA.members[0] === blakeId, JSON.stringify(namedOnA))

// A plan on a thing is used by whoever owns the thing, until someone chooses.
// Nothing is written on the plan for that: it is read from the thing, so a new
// owner takes the plan over on every device with no write to the plan at all.
const followId = crypto.randomUUID()
await A.evaluate((w) => window.__thingglance.intent(w), { action: 'create_plan', clientId: followId, payload: { name: 'E2E Follows', amount: 4, thing_ids: [outsideId] } })
const usersOn = (page, id) => page.evaluate(async (planId) => {
  const { db } = await import('/src/db/client.ts')
  const row = await db.subscriptions.get(planId)
  const things = new Map((await db.things.toArray()).map((t) => [t.id, t]))
  return row ? { ...(await import('/src/core/household.ts')).usersOf(row, things), stored: row.coversMemberIds, set: row.coversSet ?? null } : null
}, id)
await A.evaluate((id) => window.__thingglance.openLink(`thingglance://plan/${id}`), followId)
await A.waitForTimeout(600)
const followForm = A.getByRole('dialog').last()
const source = () => followForm.locator('[data-used-by-source]').getAttribute('data-used-by-source')
const following = { source: await source(), household: await followForm.locator('[data-used-by]').getByRole('button', { name: 'Household', exact: true }).getAttribute('aria-pressed') }
await followForm.locator('[data-used-by]').getByRole('button', { name: 'Blake', exact: true }).click()
const chosen = await source()
await followForm.getByRole('button', { name: 'Follow the owner of what it is attached to' }).click()
check('A: the form says a plan follows its thing\'s owner, and offers the way back once someone is picked', following.source === 'thing' && following.household === 'true' && chosen === 'set' && (await source()) === 'thing', JSON.stringify({ following, chosen }))
await followForm.getByRole('button', { name: 'Cancel', exact: true }).click()
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
const followsHousehold = await usersOn(B, followId)
check('B: a plan on the household\'s thing is the household\'s, with nothing written on the plan', followsHousehold?.who === 'household' && followsHousehold.source === 'thing' && followsHousehold.stored.length === 0 && followsHousehold.set === null, JSON.stringify(followsHousehold))
await A.evaluate(async ([id, member]) => (await import('/src/db/queries.ts')).updateThing(id, { ownerMemberId: member }), [outsideId, blakeId])
await A.waitForTimeout(4500)
await syncNow(B)
const followsBlake = await usersOn(B, followId)
check('B: the thing changes owner on A and the plan goes with it', followsBlake?.who === 'members' && followsBlake.memberIds[0] === blakeId && followsBlake.source === 'thing' && followsBlake.stored.length === 0, JSON.stringify(followsBlake))
// Chosen by hand on B: it no longer follows, on either device.
await B.evaluate(async (id) => (await import('/src/db/queries.ts')).patchSubscription(id, { coversMemberIds: [], coversHousehold: true, coversSet: true }), followId)
await B.waitForTimeout(4500)
await syncNow(A)
const overridden = await usersOn(A, followId)
check('A: once someone has chosen on B, the plan stays where it was put', overridden?.who === 'household' && overridden.source === 'set' && overridden.set === true, JSON.stringify(overridden))
await B.waitForTimeout(300)

// ── Owned since: the record of a purchase travels with everything else ──────
// Only a store build writes one (the Android shell, when the Play Store
// installed it). The dev server lets the run stand in for that shell.
const about = async (page) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'About', exact: true }).click()
  await page.waitForTimeout(400)
  const line = await page.getByText(/^Bought on /).first().textContent({ timeout: 2000 }).catch(() => null)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  return line
}
check('A: the free web app claims no purchase', (await about(A)) === null)
await A.evaluate(() => window.__thingglance.owned({ since: '2026-11-15T18:00:00.000Z', store: 'play', version: '1.0.0' }))
const boughtOnA = await about(A)
check('A: a purchase the shell reports shows in About', /^Bought on Google Play · /.test(boughtOnA ?? ''), boughtOnA ?? '')
await A.waitForTimeout(4500) // debounced push
await syncNow(B)
const boughtOnB = await about(B)
check('B: and it reaches the household\'s other device through the vault', boughtOnB === boughtOnA, boughtOnB ?? '')

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
    if (u.startsWith(vault) && !inShell) window.__seam.bypassed.push(u.slice(vault.length))
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
    // Any database holding key material: the sync package's and the one the
    // dayGLANCE key used to have. With a keystore neither may exist.
    rootKeyDatabase: dbs.filter((n) => n && n.includes('crypto')),
  }
}, TOKEN)
check('C (shell): every vault request went out on the shell\'s transport', seam.viaShell > 0 && seam.bypassed.length === 0, `via shell ${seam.viaShell}, bypassed ${JSON.stringify(seam.bypassed)}`)
check('C (shell): the vault token is in the keystore and not in localStorage', seam.configInKeystore && !seam.tokenInLocalStorage && !seam.configInLocalStorage)
check('C (shell): the root key is in the keystore, and no key of any kind is in IndexedDB', seam.rootKeyInKeystore && seam.rootKeyDatabase.length === 0, JSON.stringify(seam.rootKeyDatabase))
await C.reload()
await C.waitForTimeout(3000)
check('C (shell): after a reload it is still connected and asks for no passphrase', !(await C.getByRole('textbox', { name: 'Passphrase' }).isVisible().catch(() => false)) && await C.getByRole('button', { name: /Synced|Up to date|Sync/ }).first().isVisible().catch(() => false))
await goto(C, 'Things')
check('C (shell): it syncs like any other device', await C.getByText('E2E Outside Write').first().isVisible().catch(() => false))

// ── A first run that arrives by a link ───────────────────────────────────────
// The welcome covers the whole app on a first run. Someone whose first open
// is a product page shared into the app, or the "add" tile, came with
// somewhere to go: the welcome steps aside, and stays aside.
{
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } })
  const fresh = await ctx.newPage()
  await fresh.goto(APP)
  await fresh.waitForTimeout(800)
  check('a first run opens on the welcome', await fresh.getByRole('button', { name: /Explore with sample data/ }).isVisible().catch(() => false))
  await fresh.goto(`${APP}?link=${encodeURIComponent('action/add?name=First Run Kettle')}`)
  await fresh.waitForTimeout(1200)
  const firstRun = {
    form: (await fresh.getByLabel('Name', { exact: true }).inputValue().catch(() => '')) === 'First Run Kettle',
    welcome: await fresh.getByRole('button', { name: /Explore with sample data/ }).isVisible().catch(() => false),
  }
  check('a link on a first run shows what it opens, not the welcome over it', firstRun.form && !firstRun.welcome, JSON.stringify(firstRun))
  await fresh.goto(APP)
  await fresh.waitForTimeout(800)
  check('and the welcome does not come back', !(await fresh.getByRole('button', { name: /Explore with sample data/ }).isVisible().catch(() => false)))
  await ctx.close()
}

// ── A backup file carries each state of a plan's start ───────────────────────
// A device of its own with no vault: three plans, out to a file's text, the
// data wiped, and back in.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(APP)
  await page.waitForTimeout(1000)
  const ids = { recorded: crypto.randomUUID(), unknown: crypto.randomUUID(), not_set: crypto.randomUUID(), household: crypto.randomUUID(), members: crypto.randomUUID() }
  for (const [id, payload] of [
    [ids.recorded, { name: 'Backup Recorded', amount: 5, start_date: '2025-03-01' }],
    [ids.unknown, { name: 'Backup Unknown', amount: 6, start_date_status: 'unknown' }],
    [ids.not_set, { name: 'Backup Unanswered', amount: 7 }],
    [ids.household, { name: 'Backup Household', amount: 8, payer_member_id: 'household', used_by: 'household' }],
    [ids.members, { name: 'Backup Members', amount: 9 }],
  ]) await page.evaluate((w) => window.__thingglance.intent(w), { action: 'create_plan', clientId: id, payload })
  // No roster on this device, so the names are put on the row itself.
  await page.evaluate(async (id) => (await import('/src/db/queries.ts')).patchSubscription(id, { coversMemberIds: ['m-1', 'm-2'], coversSet: true, payerMemberId: 'm-1', responsibleMemberId: 'm-2' }), ids.members)
  const restored = await page.evaluate(async (planIds) => {
    const { buildBackup, importBackup, wipeLocalData } = await import('/src/db/backup.ts')
    const { db } = await import('/src/db/client.ts')
    const { startStatus } = await import('/src/core/money.ts')
    const { holderOf, usedBy } = await import('/src/core/household.ts')
    const text = JSON.stringify(await buildBackup())
    await wipeLocalData()
    const emptied = await db.subscriptions.count()
    const counts = await importBackup(text)
    const out = { emptied, added: counts.added }
    for (const [state, id] of Object.entries(planIds)) {
      const row = await db.subscriptions.get(id)
      out[state] = row ? `${startStatus(row)}:${row.startDate ?? ''}:${row.startUnknown ?? ''}` : 'missing'
      out[`${state}Who`] = row ? `${holderOf(row.payerMemberId)}/${holderOf(row.responsibleMemberId)}/${usedBy(row)}:${row.coversMemberIds.join('+')}:${row.coversHousehold ?? ''}:${row.coversSet ?? ''}` : 'missing'
    }
    return out
  }, ids)
  check('a backup file brings each state of a start back as it was',
    restored.emptied === 0 && restored.added === 5 && restored.recorded === 'recorded:2025-03-01:' && restored.unknown === 'unknown::true' && restored.not_set === 'not_set::',
    JSON.stringify(restored))
  check('and the household, members and "nobody has said" for who pays, deals with and uses a plan',
    restored.householdWho === 'household/household/household::true:true' && restored.membersWho === 'member/member/members:m-1+m-2::true' && restored.not_setWho === 'household/household/not_set:::',
    JSON.stringify({ household: restored.householdWho, members: restored.membersWho, unsaid: restored.not_setWho }))
  await ctx.close()
}

console.log('\n' + results.map((r) => r.join('  ')).join('\n'))
await browser.close()
process.exit(results.some((r) => r[0] === 'FAIL') ? 1 : 0)
