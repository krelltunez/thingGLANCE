// Placeholder iPhone screenshots for the App Store listing: the app itself in
// a simulator, on its sample data. Stand-ins until the framed set is made.
//
//   Boot a simulator whose screen is the size the listing takes, install a
//   debug build (docs/ios.md), open the app once and choose "Explore with
//   sample data", then:
//
//   node scripts/ios-placeholder-screenshots.mjs ['iPhone 17']
//
// 1206 x 2622 is what "iPhone with Dynamic Island (medium display)" takes, and
// what an iPhone 17 simulator captures. PNG with no alpha. The status bar is
// set to the listing's usual 9:41 for the captures and put back after.
//
// It drives the running app through scripts/ios-webview.py (a debug build's
// WebView is inspectable), so it only ever does what a tap would.
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../store-assets/apple/iphone-placeholder')
const DEVICE = process.argv[2] ?? 'iPhone 17'
const BUNDLE = 'com.thingglance.app'
mkdirSync(OUT, { recursive: true })

const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' })
// One connection to the WebView for the whole run: a line in, a line out.
const webview = spawn('python3', [resolve(here, 'ios-webview.py'), DEVICE, BUNDLE, '-'], { stdio: ['pipe', 'pipe', 'inherit'] })
const answers = createInterface({ input: webview.stdout })[Symbol.asyncIterator]()
async function page(expression) {
  webview.stdin.write(expression.replace(/\n/g, ' ') + '\n')
  const { value, done } = await answers.next()
  if (done) throw new Error('the WebView stopped answering')
  const answer = JSON.parse(value)
  if ('error' in answer) throw new Error(answer.error)
  return answer.ok
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// What a tap on a tab does, and nothing else. A tab's own text may carry a
// count beside its name (the queue's, on Glance).
async function tab(label) {
  const found = await page(`(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.textContent.replace(/[0-9]+/g, '').trim() === ${JSON.stringify(label)}).pop(); if (!b) return false; b.click(); return true })()`)
  if (!found) throw new Error(`no tab called ${label}`)
  await wait(300)
  await page(`(() => { window.scrollTo(0, 0); return true })()`)
}
// Brings a heading to just under the app's header.
const scrollTo = (heading) => page(`(() => { const h = [...document.querySelectorAll('h2')].find((e) => e.textContent === ${JSON.stringify(heading)}); if (!h) return false; window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - 110); return true })()`)
// The note about sample data is true of this capture and wrong for a listing.
const hideNote = () => page(`(() => { const hit = [...document.querySelectorAll('p, span, div')].find((e) => e.childElementCount === 0 && e.textContent.startsWith('You are looking at sample data')); let box = hit; while (box && !box.textContent.includes('Remove samples')) box = box.parentElement; if (box) box.style.display = 'none'; return !!box })()`)
const theme = (dark) => page(`(() => { document.documentElement.classList.toggle('dark', ${dark}); return true })()`)

async function save(name) {
  await hideNote()
  await wait(1200)
  const file = `${OUT}/${name}.png`
  execFileSync('xcrun', ['simctl', 'io', DEVICE, 'screenshot', '--type=png', `${file}.raw.png`], { stdio: 'ignore' })
  await sharp(`${file}.raw.png`).removeAlpha().png().toFile(file)
  execFileSync('rm', [`${file}.raw.png`])
  const meta = await sharp(file).metadata()
  console.log(`${name}  ${meta.width} x ${meta.height}  alpha: ${meta.hasAlpha}`)
}

try {
  if (!(await page(`document.body.innerText.includes('Remove samples') || !!document.querySelector('nav')`))) throw new Error('Open the app on its sample data first.')
  simctl('status_bar', DEVICE, 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100', '--wifiBars', '3', '--cellularBars', '4')
  // Anything open (a form, Settings) is closed the way its own button closes it.
  await page(`(() => { for (const b of document.querySelectorAll('[role=dialog] button[aria-label="Close"]')) b.click(); return true })()`)
  await wait(500)
  await tab('Glance')
  await save('1-glance')
  await scrollTo('Needs a decision')
  await save('2-decide')
  await tab('Horizon')
  await save('3-horizon')
  await tab('Things')
  await save('4-things')
  await tab('Plans')
  await save('5-plans')
  await tab('Glance')
  await theme(true)
  await save('6-glance-dark')
  await theme(false)
} finally {
  simctl('status_bar', DEVICE, 'clear')
  webview.stdin.end()
}
