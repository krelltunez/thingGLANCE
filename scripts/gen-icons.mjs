// Renders the PWA icon set from the two SVG sources in public/icons.
//   npm run gen:icons
// Native shells (Capacitor, Electron) will generate their own sets from the
// same sources when they arrive.
import sharp from 'sharp'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const icons = path.join(root, 'public/icons')
const favicon = path.join(root, 'public/favicon')
mkdirSync(favicon, { recursive: true })

const any = readFileSync(path.join(icons, 'icon.svg'))
const maskable = readFileSync(path.join(icons, 'icon-maskable.svg'))
const png = (svg, size, out) => sharp(svg, { density: 384 }).resize(size, size).png().toFile(out)

for (const s of [72, 96, 128, 144, 152, 192, 384, 512]) await png(any, s, path.join(icons, `icon-${s}.png`))
for (const s of [192, 512]) await png(maskable, s, path.join(icons, `icon-maskable-${s}.png`))
// iOS ignores the mask and squares the corners itself: use the full-bleed art.
await png(maskable, 180, path.join(icons, 'apple-touch-icon.png'))
for (const s of [16, 32, 48]) await png(any, s, path.join(favicon, `favicon-${s}.png`))

// favicon.ico: a single 32px PNG in an ICO container.
const p32 = await sharp(any, { density: 384 }).resize(32, 32).png().toBuffer()
const header = Buffer.alloc(22)
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
header.writeUInt8(32, 6); header.writeUInt8(32, 7); header.writeUInt8(0, 8); header.writeUInt8(0, 9)
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12)
header.writeUInt32LE(p32.length, 14); header.writeUInt32LE(22, 18)
writeFileSync(path.join(root, 'public/favicon.ico'), Buffer.concat([header, p32]))
console.log('icons written')
