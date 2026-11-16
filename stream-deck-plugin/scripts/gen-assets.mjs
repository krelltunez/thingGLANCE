// Generates what the plugin needs and git does not keep (stream-deck-plugin/.gitignore):
//  - src/generated/icons.json: the Lucide icons the keys draw (one per kind of
//    date, one per category of thing, and the keys' own), from lucide-react,
//    the package the app draws with, so a key shows the icon the app shows;
//  - the plugin's images (com.thingglance.streamdeck.sdPlugin/imgs): the app
//    icon, the thingGLANCE mark as the category icon, and a glyph and a
//    default key image per action.
//
// Run from stream-deck-plugin/ (npm run icons, part of npm run build). It reads
// the app's own node_modules (lucide-react, react-dom, sharp), so the root
// package must be installed first.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import * as Lucide from 'lucide-react'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = join(here, '..')
const app = join(plugin, '..')
const imgs = join(plugin, 'com.thingglance.streamdeck.sdPlugin', 'imgs')

// ── The icon table ──────────────────────────────────────────────────────────
// The names are read from the plugin's own source (src/keyIcons.ts), so the
// table always holds exactly what the keys ask for.
const source = readFileSync(join(plugin, 'src', 'keyIcons.ts'), 'utf-8')
const names = [...new Set([...source.matchAll(/'([A-Z][A-Za-z0-9]+)'/g)].map((m) => m[1]))]
const inner = (name) => {
  const component = Lucide[name]
  if (!component) throw new Error(`no Lucide icon ${name}`)
  return renderToStaticMarkup(createElement(component)).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
}
const icons = Object.fromEntries(names.map((n) => [n, inner(n)]))
mkdirSync(join(plugin, 'src', 'generated'), { recursive: true })
writeFileSync(join(plugin, 'src', 'generated', 'icons.json'), JSON.stringify({ icons }))
console.log(`icons: ${names.length}`)

// ── Images ──────────────────────────────────────────────────────────────────
const svgIcon = (name, size, color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</svg>`

// The thingGLANCE mark (the tray's drawing, scripts/gen-desktop-icons.mjs):
// the lifespan ring with a quarter of it spent, around the thing.
const mark = (size, color) => {
  const r = 7.6, around = 2 * Math.PI * r
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 22 22">
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="${color}" stroke-opacity="0.3" stroke-width="2"/>
    <circle cx="11" cy="11" r="${r}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${around * 0.72} ${around}" transform="rotate(-90 11 11)"/>
    <rect x="8.5" y="8.5" width="5" height="5" rx="1.2" fill="${color}"/></svg>`
}

const keyImage = (name, accent) => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#0b1020"/><g transform="translate(36 36) scale(3)" fill="none" stroke="${accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner(name)}</g></svg>`

const write = (rel, data) => { const p = join(imgs, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data) }

// The plugin's own icon: the app's icon, at Stream Deck's two sizes.
mkdirSync(join(imgs, 'plugin'), { recursive: true })
await sharp(join(app, 'electron', 'resources', 'icon.png')).resize(256, 256).png().toFile(join(imgs, 'plugin', 'icon.png'))
await sharp(join(app, 'electron', 'resources', 'icon.png')).resize(512, 512).png().toFile(join(imgs, 'plugin', 'icon@2x.png'))
write('plugin/category.svg', mark(28, '#ffffff'))

// Each action: a white glyph for Stream Deck's action list, and a default key.
export const ACTION_ICONS = {
  queue: ['ListChecks', '#f59e0b'],
  waiting: ['BellRing', '#f59e0b'],
  'coming-up': ['CalendarClock', '#7dd3fc'],
  charges: ['Repeat', '#a78bfa'],
  thing: ['Box', '#7dd3fc'],
  'add-thing': ['Plus', '#7dd3fc'],
}
for (const [action, [name, accent]] of Object.entries(ACTION_ICONS)) {
  write(`actions/${action}/icon.svg`, svgIcon(name, 20, '#ffffff'))
  write(`actions/${action}/key.svg`, keyImage(name, accent))
}
console.log(`images: ${imgs}`)
