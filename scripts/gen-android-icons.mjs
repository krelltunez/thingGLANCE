// Renders the Android launcher icons and splash images from the same artwork
// as the web icons (public/icons).
//   node scripts/gen-android-icons.mjs
// Run it again after changing the artwork; the PNGs it writes are committed.
import sharp from 'sharp'
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const res = path.join(root, 'android/app/src/main/res')
const INK = '#05081A'

// The mark: the lifespan ring and the thing inside it, on a 512 canvas,
// centred. `scale` is how much of the canvas it fills (1 = as in icon.svg).
const mark = (scale, { mono = false } = {}) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="156" fill="none" stroke="${mono ? '#FFFFFF' : '#1D2538'}" stroke-opacity="${mono ? 0.35 : 1}" stroke-width="34"/>
    <circle cx="256" cy="256" r="156" fill="none" stroke="${mono ? '#FFFFFF' : 'url(#arc)'}" stroke-width="34" stroke-linecap="round"
            stroke-dasharray="705 980" transform="rotate(-90 256 256)"/>
    <rect x="196" y="196" width="120" height="120" rx="26" fill="${mono ? 'none' : '#0F1A36'}" stroke="${mono ? '#FFFFFF' : '#7DD3FC'}" stroke-width="12"/>
    <rect x="236" y="236" width="40" height="40" rx="9" fill="${mono ? '#FFFFFF' : '#7DD3FC'}"/>
  </g>`
const svg = (body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="arc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#BAE6FD"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs>
  ${body}</svg>`)
const png = (source, size, out) => sharp(source, { density: 384 }).resize(size, size).png().toFile(out)

// An adaptive icon is 108dp of which the launcher shows the middle 72dp, in
// whatever shape it likes; only the central 66dp is always visible. The mark
// is 346 of 512 wide at scale 1, so 0.86 keeps it inside that circle.
const foreground = svg(mark(0.86))
const monochrome = svg(mark(0.86, { mono: true }))
// Launchers older than Android 8 use a plain image: the rounded square, and a
// circle for those that ask for one.
const legacy = svg(`<rect width="512" height="512" rx="92" fill="${INK}"/>${mark(1)}`)
const round = svg(`<circle cx="256" cy="256" r="256" fill="${INK}"/>${mark(0.86)}`)

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [name, factor] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${name}`)
  await png(legacy, Math.round(48 * factor), path.join(dir, 'ic_launcher.png'))
  await png(round, Math.round(48 * factor), path.join(dir, 'ic_launcher_round.png'))
  await png(foreground, Math.round(108 * factor), path.join(dir, 'ic_launcher_foreground.png'))
  await png(monochrome, Math.round(108 * factor), path.join(dir, 'ic_launcher_monochrome.png'))
}

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <!-- Android 13+ themed icons: the mark alone, tinted by the system. -->
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`
writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher.xml'), adaptive)
writeFileSync(path.join(res, 'mipmap-anydpi-v26/ic_launcher_round.xml'), adaptive)
writeFileSync(path.join(res, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${INK}</color>
</resources>
`)

// The splash images Capacitor's launch theme shows, each at the size the
// scaffold made it: the app's dark background with the mark in the middle.
for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const file = path.join(res, dir, 'splash.png')
  let meta
  try { meta = await sharp(file).metadata() } catch { continue }
  const side = Math.round(Math.min(meta.width, meta.height) * 0.34)
  const logo = await sharp(svg(mark(1)), { density: 384 }).resize(side, side).png().toBuffer()
  const out = await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: INK } }).composite([{ input: logo, gravity: 'centre' }]).png().toBuffer()
  writeFileSync(file, out)
}
console.log('android icons written')
