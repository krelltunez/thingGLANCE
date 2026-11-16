#!/usr/bin/env node
// Desktop smoke test (docs/desktop.md): launch the PACKAGED app
// (electron-builder --dir output, so app.isPackaged is true and the real app://
// protocol serves the bundle) and check what no unit test can see:
//
//   - the page is on app://thingglance, the origin the data lives under;
//   - the preload exposed the bridge, with this build's version;
//   - Dexie opened the `thingglance` database there;
//   - no service worker registered;
//   - the CSP blocks a direct network request from the renderer;
//   - the desktop chrome classes are set and `native` is not;
//   - requests go through the main process: a server on a private address is
//     refused until granted, then reached, and the grant can be revoked;
//   - the vault's live stream is read by main and reaches the page;
//   - the keystore round-trips where the OS has one;
//   - a backup goes out through the save dialog;
//   - background mode: the settings answer with their defaults, and a global
//     shortcut registers where the popup exists;
//   - with the sample data loaded, the reminder plan reaches the scheduler in
//     main and the tray popup (the same bundle in its own window) draws the
//     dates waiting on a decision; "Done" there is queued by main, applied by
//     the page to its database, and the row leaves the popup;
//   - a thingglance:// link handed to the app opens where it says;
//   - the update check answers without throwing, and a direct build reports
//     no purchase;
//   - the MCP server: off until turned on through the same transition Settings
//     sends; then the official client over real HTTP lists the tools and reads
//     the overview from the page's database; with "Allow changes" a thing it
//     adds lands in the database and in the journal, and Settings' undo takes
//     it back out; the discovery file is there while it runs; turning it off
//     frees the port;
//   - Stream Deck: off until turned on; then the listener hands a client with
//     no Origin a token and the state the keys draw; a press settles a date in
//     the page's database, once, and a second press is answered too_soon; a
//     page (a client with an Origin) is not let in; turning it off frees the
//     port;
//   - the page's log lines reach the log file;
//   - no uncaught page error.
//
// It runs on a profile of its own (THINGGLANCE_USER_DATA_DIR) and a mock
// keychain, never the ones a person's installed copy uses.
//
// Usage: npm run build:electron:dir && npm run test:electron-smoke
// Linux CI runs it under xvfb-run. SMOKE_SCREENSHOT=path saves a screenshot.
import { _electron as electron } from 'playwright-core'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { WebSocket } from 'ws'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'))

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
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const profile = mkdtempSync(path.join(os.tmpdir(), 'thingglance-smoke-profile-'))
const app = await electron.launch({
  executablePath,
  args: LAUNCH_ARGS,
  env: { ...process.env, THINGGLANCE_USER_DATA_DIR: profile, THINGGLANCE_SMOKE_HOOKS: '1' },
  timeout: 60_000,
})
const pageErrors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  await page.waitForLoadState('load')
  // The app is up once React has rendered its header.
  await page.waitForSelector('header', { timeout: 30_000 })

  const url = page.url()
  check(url.startsWith('app://thingglance/'), `page is on app://thingglance (${url})`)

  const userData = await app.evaluate(({ app }) => app.getPath('userData'))
  check(userData === profile, `runs on its own profile (${userData})`)

  const info = await page.evaluate(() => window.thingglanceDesktop?.info ?? null)
  check(info?.version === version, `bridge reports version ${version} (${info?.version})`)
  const mainPlatform = await app.evaluate(() => process.platform)
  check(info?.platform === mainPlatform, `bridge reports the platform (${info?.platform})`)
  check(info?.isMAS === false, 'bridge reports a non-MAS build')

  // Secure storage: a round trip where the OS protects secrets; elsewhere
  // (Linux without a keyring, as on CI) the app reports it and keeps web storage.
  if (info?.secureStorage === true) {
    const stored = await page.evaluate(async () => {
      const s = window.thingglanceDesktop.secureStore
      await s.set('smoke-test', 'v')
      const { value } = await s.get('smoke-test')
      await s.delete('smoke-test')
      const after = await s.get('smoke-test')
      return [value, after.value]
    })
    check(stored[0] === 'v' && stored[1] === null, 'secure storage round-trips, and an absent key reads as null')
  } else {
    check(info?.secureStorage === false, `secure storage reported unavailable here (${info?.secureStorage})`)
  }

  // The header can render before Dexie's first open on a fresh profile has
  // committed, and indexedDB.databases() lists a database only once it has.
  let dbs = []
  for (let i = 0; i < 100 && !dbs.includes('thingglance'); i++) {
    if (i) await new Promise((r) => setTimeout(r, 100))
    dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
  }
  check(dbs.includes('thingglance'), `Dexie opened the thingglance database (${dbs.join(', ')})`)

  // app:// is not registered with allowServiceWorkers, so Chromium refuses the
  // API outright there (InvalidStateError): no worker can ever control the page.
  const sw = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported'
    if (navigator.serviceWorker.controller) return 'controlled'
    try {
      return `${(await navigator.serviceWorker.getRegistrations()).length} registrations`
    } catch (e) {
      return e instanceof DOMException && e.name === 'InvalidStateError' ? 'refused on this origin' : `error: ${e}`
    }
  })
  check(['unsupported', '0 registrations', 'refused on this origin'].includes(sw), `no service worker (${sw})`)

  const csp = await page.evaluate(() => new Promise((resolve) => {
    const onViolation = (e) => resolve(e.violatedDirective)
    document.addEventListener('securitypolicyviolation', onViolation, { once: true })
    fetch('https://example.com/').catch(() => {})
    setTimeout(() => resolve(null), 5000)
  }))
  check(csp === 'connect-src', `CSP blocks a direct network request (${csp})`)

  const classes = await page.evaluate(() => document.documentElement.className)
  check(/\bdesktop\b/.test(classes) && classes.includes(`desktop-${info?.platform}`), `desktop chrome classes set (${classes})`)
  check(!/\bnative\b/.test(classes), 'not marked as a Capacitor native shell')

  // The network path, against a local server: 127.0.0.1 is a private address,
  // so it needs a grant. The native dialog is answered "Allow" by replacing
  // showMessageBox in the main process.
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`)
    if (req.url.startsWith('/events')) {
      // A heartbeat, then one event, then held open like a real vault.
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(': heartbeat\n\n')
      res.write('data: {"seq":42}\n\n')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true,"allowedApps":["thingglance"]}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const target = `http://127.0.0.1:${server.address().port}/healthz`
  try {
    const call = (fn, ...args) => page.evaluate(([f, a]) => window.thingglanceDesktop.http[f](...a), [fn, args])
    const refused = await call('request', 'GET', target, {}, null)
    check(refused?.error === 'Private/reserved address' && hits.length === 0, `a private address is refused before any request (${JSON.stringify(refused)})`)
    const inspected = await call('inspect', target)
    check(inspected?.blocked === true && inspected?.canGrant === true, `the page can ask first, and learns a grant would unlock it (${JSON.stringify(inspected)})`)
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }) })
    const granted = await call('grant', target, {})
    const reached = await call('request', 'GET', target, {}, null)
    check(granted?.ok === true && reached?.status === 200 && hits.length === 1, `once granted, the request reaches the server (${reached?.status}, ${hits.join(', ')})`)
    const origin = new URL(target).origin
    const listed = await call('grants')
    check(listed.some((g) => g.origin === origin), 'the grant is listed for Settings')
    await call('revoke', origin)
    const again = await call('request', 'GET', target, {}, null)
    check(again?.error === 'Private/reserved address' && hits.length === 1, 'a revoked grant refuses again')

    // GLANCEvault's live stream, read by the main process and relayed.
    await call('grant', target, {})
    const sse = await page.evaluate(([vaultUrl]) => new Promise((resolve) => {
      const seen = []
      const stop = window.thingglanceDesktop.vaultSse.onMessage((m) => {
        seen.push(m)
        if (m.type === 'frame') { stop(); void window.thingglanceDesktop.vaultSse.stop(); resolve(seen) }
      })
      void window.thingglanceDesktop.vaultSse.start({ vaultUrl, vaultToken: 'smoke', accountId: 'a1' })
      setTimeout(() => { stop(); resolve(seen) }, 8000)
    }), [origin])
    const types = sse.map((m) => m.type).join(',')
    check(types === 'open,frame' && sse[1].block === 'data: {"seq":42}' && hits.includes('GET /events?accountId=a1'),
      `vault live updates reach the page (${types})`)
    await call('revoke', origin)
  } finally {
    server.closeAllConnections?.()
    server.close()
  }

  // A backup: the native save dialog (answered with a temp path), and a copy
  // written silently into the app's backups folder.
  const exportDir = mkdtempSync(path.join(os.tmpdir(), 'thingglance-smoke-export-'))
  try {
    const chosen = path.join(exportDir, 'chosen.json')
    await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, chosen)
    const saved = await page.evaluate(async () => {
      const f = window.thingglanceDesktop.files
      const r = await f.saveText({ filename: 'backup.json', text: '{"saved":true}' })
      await f.stash({ filename: 'smoke-copy.json', text: '{"stashed":true}' })
      return r.saved
    })
    const stashed = path.join(userData, 'backups', 'smoke-copy.json')
    check(saved && readFileSync(chosen, 'utf-8') === '{"saved":true}' && readFileSync(stashed, 'utf-8') === '{"stashed":true}',
      'a backup goes out through the save dialog, and a copy into the backups folder')
  } finally {
    rmSync(exportDir, { recursive: true, force: true })
  }

  // Background mode and shortcuts: the settings main keeps, as Settings reads them.
  const bg = await page.evaluate(async () => {
    const d = window.thingglanceDesktop
    const settings = await d.shell.getBackgroundSettings()
    const shortcuts = await d.shell.getShortcuts()
    const windowSet = await d.shell.setShortcut('window', 'Ctrl+Alt+F11')
    const cleared = await d.shell.setShortcut('window', '')
    const nonsense = await d.shell.setShortcut('window', 'not a shortcut')
    return { settings, shortcuts, windowSet, cleared, nonsense }
  })
  check(bg.settings?.keepRunning === true && bg.settings?.openAtLogin === false, `background settings default to keep running, not at login (${JSON.stringify(bg.settings)})`)
  check(bg.shortcuts?.popup === '' && bg.shortcuts?.window === '' && bg.shortcuts?.popupSupported === (mainPlatform !== 'linux'),
    `global shortcuts answer, none set (${JSON.stringify(bg.shortcuts)})`)
  check(bg.cleared?.window === '' && bg.nonsense?.ok === false, `a shortcut can be set and cleared, and nonsense is refused (set: ${bg.windowSet?.ok})`)

  // A direct build: it may hear of a newer release, and it was not bought.
  const direct = await page.evaluate(async () => ({
    update: await window.thingglanceDesktop.shell.latestRelease().then((r) => r, (e) => `threw: ${e}`),
    owned: await window.thingglanceDesktop.ownership.get(),
  }))
  // No network assumption: the check answers null or a release, never throws.
  check(direct.update === null || typeof direct.update?.version === 'string', `the update check answers (${JSON.stringify(direct.update)})`)
  check(JSON.stringify(direct.owned) === '{}' && !existsSync(path.join(userData, 'owned.json')), 'a direct build reports no purchase, and records none')

  // Sample data gives the app dates to show. From here the page feeds main:
  // the reminder plan, and what the tray draws.
  await page.getByRole('button', { name: /Explore with sample data/ }).click()
  await page.getByRole('tab', { name: /^Glance/ }).first().waitFor({ timeout: 15_000 })
  let planned = []
  for (let i = 0; i < 100 && planned.length === 0; i++) {
    if (i) await new Promise((r) => setTimeout(r, 100))
    planned = await page.evaluate(() => window.thingglanceDesktop.reminders.pending())
  }
  check(planned.length > 0 && planned.every((r) => r.at > Date.now() && r.link.startsWith('thingglance://event/') && r.title),
    `the reminder plan reaches the scheduler in main (${planned.length} pending, next: ${planned[0]?.title})`)

  // The tray popup: the same bundle in its own window, drawn from what main holds.
  await app.evaluate(() => globalThis.__thingglanceSmoke.toggleTrayPopup())
  let trayPage = null
  for (let i = 0; i < 100 && !trayPage; i++) {
    if (i) await new Promise((r) => setTimeout(r, 100))
    trayPage = app.windows().find((w) => w.url().includes('tray=1')) ?? null
  }
  check(trayPage !== null, 'the tray popup opens in a window of its own')
  if (trayPage) {
    trayPage.on('pageerror', (err) => pageErrors.push(`tray: ${err}`))
    const done = trayPage.getByRole('button', { name: 'Done with this' })
    await done.first().waitFor({ timeout: 15_000 }).catch(() => {})
    const before = await done.count()
    const headline = await trayPage.locator('main p').first().innerText().catch(() => '')
    check(before > 0 && /want(s)? a decision/.test(headline), `the popup lists the dates waiting on a decision (${before} rows; "${headline}")`)
    const decisions = () => page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('thingglance')
      open.onsuccess = () => {
        const all = open.result.transaction('decisions').objectStore('decisions').getAll()
        all.onsuccess = () => { open.result.close(); resolve(all.result.filter((d) => d.state === 'done').length) }
      }
      open.onerror = () => resolve(-1)
    }))
    const decidedBefore = await decisions()
    await done.first().click()
    let after = before
    for (let i = 0; i < 100 && after >= before; i++) { await new Promise((r) => setTimeout(r, 100)); after = await done.count() }
    check(after === before - 1, `"Done" takes the row out of the popup at once (${before} to ${after})`)
    let decidedAfter = decidedBefore
    for (let i = 0; i < 100 && decidedAfter <= decidedBefore; i++) { await new Promise((r) => setTimeout(r, 100)); decidedAfter = await decisions() }
    check(decidedAfter === decidedBefore + 1, `the page applied it to its database (${decidedBefore} to ${decidedAfter} decided)`)
    let queue = 'x'
    for (let i = 0; i < 50 && queue !== '[]'; i++) { await new Promise((r) => setTimeout(r, 100)); queue = await page.evaluate(() => window.thingglanceDesktop.commands.take()) }
    check(queue === '[]', 'and acknowledged it, so the queue is empty')
    await new Promise((r) => setTimeout(r, 1500))
    check((await done.count()) === before - 1, 'the row stays gone once the next snapshot arrives')
    // The popup is a widget: main answers the keystore and the network to the main window only.
    const reach = await trayPage.evaluate(async () => {
      const d = window.thingglanceDesktop
      const http = await d.http.request('GET', 'https://example.com/', {}, null)
      const secret = await d.secureStore.get('thingglance-vault-config').then(() => 'answered', () => 'refused')
      return { http: http.error ?? 'answered', secret }
    })
    check(reach.http === 'Not allowed from this window' && reach.secret === 'refused', `the popup's window gets no network and no keystore (${JSON.stringify(reach)})`)
    if (process.env.SMOKE_SCREENSHOT) await trayPage.screenshot({ path: process.env.SMOKE_SCREENSHOT.replace(/\.png$/, '-tray.png') })
  }

  // A link from outside: main keeps it, the page opens it.
  await app.evaluate(({ app }) => { app.emit('open-url', { preventDefault() {} }, 'thingglance://settings/about') })
  const opened = await page.getByText(/^v\d+\.\d+\.\d+ · built/).waitFor({ timeout: 10_000 }).then(() => true, () => false)
  check(opened, 'a thingglance:// link opens the app where it says (Settings, About)')
  await app.evaluate(({ app }) => { app.emit('open-url', { preventDefault() {} }, 'https://example.com/not-ours') })
  const stray = await page.evaluate(() => window.thingglanceDesktop.links.consume())
  check(stray.link === null, 'anything that is not a thingglance:// link is dropped')

  // The MCP server (docs/mcp.md). On a port of its own, so a copy someone is
  // running on the default one is left alone.
  const mcpPort = await new Promise((resolve) => { const p = net.createServer(); p.listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)) }) })
  const li = (action) => page.evaluate((a) => window.thingglanceDesktop.localIntegrations.transition(a), action)
  const before = await page.evaluate(() => window.thingglanceDesktop.localIntegrations.get())
  check(before?.mcp?.readTier === 'off' && before?.mcp?.token === null && before?.assistant === 'off', 'MCP is off until turned on, with no token')
  const refusedOn = await li({ type: 'set-mcp-read-tier', tier: 'on' })
  check(refusedOn?.ok === false && refusedOn?.error === 'consent_required', 'it cannot be turned on without the consent dialog')
  await li({ type: 'set-mcp-port', port: mcpPort })
  const mcpOn = await li({ type: 'set-mcp-read-tier', tier: 'on', consentConfirmed: true })
  check(mcpOn?.ok === true && /^[0-9a-f]{64}$/.test(mcpOn.view?.mcp?.token ?? ''), 'MCP turns on through the bridge, with a token')
  let mcpView = mcpOn?.view
  for (let i = 0; i < 50 && !mcpView?.mcp?.status?.running && !mcpView?.mcp?.status?.error; i++) {
    await new Promise((r) => setTimeout(r, 100))
    mcpView = await page.evaluate(() => window.thingglanceDesktop.localIntegrations.get())
  }
  check(mcpView?.mcp?.status?.running === true && mcpView?.assistant === 'on', `the MCP listener runs, and the indicator is green (${JSON.stringify(mcpView?.mcp?.status)})`)
  const discovery = path.join(userData, 'mcp.json')
  const found = existsSync(discovery) ? JSON.parse(readFileSync(discovery, 'utf-8')) : null
  check(found?.port === mcpPort && found?.token === mcpView?.mcp?.token, 'the discovery file carries the port and the token while it runs')

  if (mcpView?.mcp?.status?.running) {
    const client = new Client({ name: 'thingglance-smoke', version: '0.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpView.mcp.endpoint), { requestInit: { headers: { Authorization: `Bearer ${mcpView.mcp.token}` } } }))
    const tool = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); return { error: r.isError === true, body: JSON.parse(r.content[0].text) } }
    try {
      const tools = (await client.listTools()).tools.map((t) => t.name)
      check(tools.includes('thingglance_get_overview') && tools.includes('thingglance_create_thing') && !tools.some((n) => /delete/.test(n)), `the official client lists the tools (${tools.length}), none of which deletes`)
      const overview = await tool('thingglance_get_overview')
      check(!overview.error && overview.body.counts?.things_in_service > 0 && typeof overview.body.timezone === 'string',
        `the overview comes from the page's database (${overview.body.counts?.things_in_service} things in service, ${overview.body.counts?.needs_decision} waiting)`)
      const things = await tool('thingglance_list_things', { limit: 3 })
      check(!things.error && things.body.items?.length === 3 && typeof things.body.items[0].thing_id === 'string', 'a list is paginated')

      const readOnly = await tool('thingglance_create_thing', { name: 'Smoke thing' })
      check(readOnly.error && readOnly.body.error?.code === 'read_only_mode', 'a change is refused while "Allow changes" is off')
      const writesOn = await li({ type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true })
      check(writesOn?.ok === true && writesOn.view?.mcp?.writesEnabled === true, '"Allow changes" turns on with its own consent')
      const countThings = (name) => page.evaluate((n) => new Promise((resolve) => {
        const open = indexedDB.open('thingglance')
        open.onsuccess = () => {
          const all = open.result.transaction('things').objectStore('things').getAll()
          all.onsuccess = () => { open.result.close(); resolve(all.result.filter((t) => t.name === n).length) }
        }
        open.onerror = () => resolve(-1)
      }), name)
      const created = await tool('thingglance_create_thing', { name: 'Smoke thing', price: 42, idempotency_key: 'smoke-1' })
      check(!created.error && created.body.thing?.name === 'Smoke thing' && (await countThings('Smoke thing')) === 1, 'an assistant adds a thing, and it lands in the database')
      const replayed = await tool('thingglance_create_thing', { name: 'Smoke thing', price: 42, idempotency_key: 'smoke-1' })
      check(replayed.body.replayed === true && (await countThings('Smoke thing')) === 1, 'the same key again changes nothing')
      const edited = await tool('thingglance_update_thing', { thing_id: created.body.thing.thing_id, price: 40 })
      check(!edited.error && edited.body.thing?.price === 40, 'and edits it')
      const journal = await page.evaluate(() => window.thingglanceDesktop.mcpJournal.get())
      const afterWrite = await page.evaluate(() => window.thingglanceDesktop.localIntegrations.get())
      check(journal?.total === 2 && journal.groups.length === 1 && afterWrite?.assistant === 'undo', `the journal holds both changes as one item, and the indicator turns blue (${journal?.total})`)
      const undone = await page.evaluate(() => window.thingglanceDesktop.mcpJournal.undo(null))
      check(undone?.ok === true && undone.undone === 2 && (await countThings('Smoke thing')) === 0, `undo takes it back out of the database (${JSON.stringify(undone)})`)
    } finally {
      await client.close().catch(() => {})
    }
    const mcpOff = await li({ type: 'set-mcp-read-tier', tier: 'off' })
    const freed = await new Promise((resolve) => {
      const probe = net.createConnection({ host: '127.0.0.1', port: mcpPort })
      probe.once('connect', () => { probe.destroy(); resolve(false) })
      probe.once('error', () => resolve(true))
    })
    check(mcpOff?.ok === true && freed && !existsSync(discovery), 'turning it off frees the port and removes the discovery file')
  }

  // Stream Deck (docs/stream-deck.md): the listener the plugin connects to.
  const deckOn = await li({ type: 'set-stream-deck', enabled: true })
  let deckView = deckOn?.view
  for (let i = 0; i < 50 && !deckView?.streamDeck?.status?.running && !deckView?.streamDeck?.status?.error; i++) {
    await new Promise((r) => setTimeout(r, 100))
    deckView = await page.evaluate(() => window.thingglanceDesktop.localIntegrations.get())
  }
  // Another copy holding the port (someone's own, with Stream Deck on) is not this build's failure.
  if (deckView?.streamDeck?.status?.error === 'port_in_use') {
    console.log(`skip Stream Deck: port ${deckView.streamDeck.port} is in use on this machine`)
  } else {
    check(deckView?.streamDeck?.status?.running === true, `the Stream Deck listener runs on port ${deckView?.streamDeck?.port} (${JSON.stringify(deckView?.streamDeck?.status)})`)
    const deckUrl = `ws://127.0.0.1:${deckView.streamDeck.port}`
    const messages = []
    const ws = new WebSocket(deckUrl)
    ws.on('message', (d) => messages.push(JSON.parse(String(d))))
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
    const until = async (find) => { for (let i = 0; i < 80; i++) { const m = messages.find(find); if (m) return m; await new Promise((r) => setTimeout(r, 100)) } return null }
    const token = await until((m) => m.type === 'tg:token')
    const first = await until((m) => m.type === 'tg:state' && m.ready)
    check(/^[0-9a-f]{32}$/.test(token?.token ?? '') && first?.queue?.length > 0 && first.waiting === first.queue.length,
      `the plugin's client is let in and handed the queue (${first?.queue?.length} waiting, ${first?.things?.length} things)`)
    const target = first?.queue?.[0]
    const doneCount = () => page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('thingglance')
      open.onsuccess = () => {
        const all = open.result.transaction('decisions').objectStore('decisions').getAll()
        all.onsuccess = () => { open.result.close(); resolve(all.result.filter((d) => d.state === 'done').length) }
      }
      open.onerror = () => resolve(-1)
    }))
    const doneBefore = await doneCount()
    ws.send(JSON.stringify({ v: 1, type: 'tg:event:decide', key: target?.key, clientId: 'smoke-1' }))
    const pressed = await until((m) => m.type === 'tg:result' && m.clientId === 'smoke-1')
    let doneAfter = doneBefore
    for (let i = 0; i < 100 && doneAfter <= doneBefore; i++) { await new Promise((r) => setTimeout(r, 100)); doneAfter = await doneCount() }
    check(pressed?.ok === true && doneAfter === doneBefore + 1, `a press settles the date in the page's database (${doneBefore} to ${doneAfter} done)`)
    const shorter = await until((m) => m.type === 'tg:state' && !m.queue.some((e) => e.key === target?.key))
    check(shorter !== null, 'and the keys are told it is gone')
    ws.send(JSON.stringify({ v: 1, type: 'tg:event:decide', key: target?.key, clientId: 'smoke-2' }))
    const again = await until((m) => m.type === 'tg:result' && m.clientId === 'smoke-2')
    await new Promise((r) => setTimeout(r, 500))
    check(again?.ok === false && again.reason === 'too_soon' && (await doneCount()) === doneAfter, `a second press is answered ${again?.reason}, and writes nothing`)
    ws.send(JSON.stringify({ v: 1, type: 'tg:open', target: 'https://example.com/', clientId: 'smoke-3' }))
    const stray = await until((m) => m.type === 'tg:result' && m.clientId === 'smoke-3')
    check(stray?.ok === false && stray.reason === 'refused', 'a key cannot open anything but a thingglance:// link')
    // A web page is a client with an Origin: it has to prove itself, and cannot.
    const pageClosed = await new Promise((resolve) => {
      const intruder = new WebSocket(deckUrl, { headers: { Origin: 'https://example.com' } })
      const seen = []
      intruder.on('message', (d) => seen.push(String(d)))
      intruder.once('open', () => intruder.send(JSON.stringify({ v: 1, type: 'tg:auth', token: 'f'.repeat(32) })))
      intruder.once('close', () => resolve(seen.length === 0))
      intruder.once('error', () => resolve(true))
      setTimeout(() => resolve(false), 8000)
    })
    check(pageClosed, 'a web page is dropped without being told anything')
    ws.close()
    await li({ type: 'set-stream-deck', enabled: false })
    const deckFreed = await new Promise((resolve) => {
      const probe = net.createConnection({ host: '127.0.0.1', port: deckView.streamDeck.port })
      probe.once('connect', () => { probe.destroy(); resolve(false) })
      probe.once('error', () => resolve(true))
    })
    check(deckFreed, 'turning Stream Deck off frees the port')
  }

  // The page's lines reach the log file in userData (shell.log).
  const logLine = `smoke-log-${Date.now()}`
  await page.evaluate((line) => window.thingglanceDesktop.shell.log(line), logLine)
  const logFile = path.join(userData, 'thingglance-startup.log')
  let logged = false
  for (let i = 0; i < 20 && !logged; i++) {
    logged = existsSync(logFile) && readFileSync(logFile, 'utf-8').includes(`page: ${logLine}`)
    if (!logged) await new Promise((r) => setTimeout(r, 100))
  }
  check(logged, 'the page writes to the log file')

  if (process.env.SMOKE_SCREENSHOT) await page.screenshot({ path: process.env.SMOKE_SCREENSHOT })
  check(pageErrors.length === 0, `no uncaught page errors${pageErrors.length ? `: ${pageErrors.join(' | ')}` : ''}`)
} finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log('\ndesktop smoke test passed')
