#!/usr/bin/env node
// The iOS app's icon and launch image (docs/ios.md), rendered from the same
// artwork as the PWA's (public/icons/icon.svg) into the asset catalog:
//
//   AppIcon-512@2x.png   1024px, full bleed and opaque. iOS cuts the corners
//                        itself, and refuses an icon with transparency, so the
//                        artwork's own rounded ground is squared off first.
//   splash-2732x2732*    the launch screen: the mark, small, in the middle of
//                        the icon's dark ground. One picture serves every
//                        screen (the storyboard fills the screen with it), so
//                        only the middle is ever sure to be seen.
//
// Run after a brand change and commit the output:
//
//   node scripts/gen-ios-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const icon = fs.readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf-8')
const assets = path.join(root, 'ios/App/App/Assets.xcassets')

const ground = icon.match(/<rect width="512" height="512" rx="[\d.]+" fill="(#[0-9A-Fa-f]{6})"\/>/)
if (!ground) throw new Error('public/icons/icon.svg: the ground rectangle was not found')
const GROUND = ground[1]

// The artwork with its ground squared off.
const square = icon.replace(/(<rect width="512" height="512") rx="[\d.]+"/, '$1')
await sharp(Buffer.from(square), { density: 300 })
  .resize(1024, 1024)
  .flatten({ background: GROUND })
  .png()
  .toFile(path.join(assets, 'AppIcon.appiconset/AppIcon-512@2x.png'))

// The mark alone (no ground), a fifth of the canvas wide, centred.
const SPLASH = 2732
const MARK = 560
const mark = await sharp(Buffer.from(square), { density: 300 }).resize(MARK, MARK).png().toBuffer()
const splash = await sharp({ create: { width: SPLASH, height: SPLASH, channels: 3, background: GROUND } })
  .composite([{ input: mark, left: (SPLASH - MARK) / 2, top: (SPLASH - MARK) / 2 }])
  .png()
  .toBuffer()
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  fs.writeFileSync(path.join(assets, 'Splash.imageset', name), splash)
}
console.log('wrote the iOS icon and launch image')
