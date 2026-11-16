#!/usr/bin/env node
// Writes the iOS version settings to ios/version.generated.xcconfig.
//
// That file is not in git. ios/debug.xcconfig and ios/release.xcconfig, the
// project's base configurations, include it, so the app and every extension
// take the same two values and a build never touches the committed
// project.pbxproj. After lastGLANCE's scripts/sync-ios-version.mjs.
//
//   MARKETING_VERSION (CFBundleShortVersionString) is the version people see.
//   It is package.json's, as on Android.
//
//   CURRENT_PROJECT_VERSION (CFBundleVersion) is the build number. App Store
//   Connect wants the pair (version, build) to be new on every upload. By
//   default it is the number Android's versionCode is (0.1.0 -> 10000), which
//   rises with every release and leaves 100 spare per patch. A second upload
//   of the same version needs the next one:
//
//       IOS_BUILD=10001 npm run build:ios
//
//   A number set that way is kept on this machine until the version changes.
//
// project.pbxproj must set neither. A target's own setting wins over the
// xcconfig without a word, which is how an app and its extensions come to ship
// different numbers (App Store Connect refuses the upload). Xcode writes one
// when the Version or Build field in a target's General tab is edited, so that
// is checked first.
//
// Usage: node scripts/sync-ios-version.mjs   (from anywhere)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
const pbxPath = resolve(root, 'ios/App/App.xcodeproj/project.pbxproj')
const xcconfigPath = resolve(root, 'ios/version.generated.xcconfig')

const pbx = readFileSync(pbxPath, 'utf8')
const overriding = ['MARKETING_VERSION', 'CURRENT_PROJECT_VERSION'].filter((k) => pbx.includes(`${k} = `))
if (overriding.length > 0) {
  console.error(
    `error: project.pbxproj sets ${overriding.join(' and ')}, which overrides\n` +
    '       ios/version.generated.xcconfig. Xcode writes these when the Version or\n' +
    "       Build field in a target's General tab is edited. Remove those lines:\n" +
    '       the version is package.json\'s and the build number is derived from it\n' +
    '       (or IOS_BUILD).',
  )
  process.exit(1)
}

const [major, minor, patch] = version.split('-')[0].split('.').map(Number)
if (![major, minor, patch].every(Number.isInteger)) {
  console.error(`error: package.json's version "${version}" is not major.minor.patch`)
  process.exit(1)
}
const derived = String(major * 1000000 + minor * 10000 + patch * 100)

const previous = existsSync(xcconfigPath) ? readFileSync(xcconfigPath, 'utf8') : ''
const lastVersion = previous.match(/^MARKETING_VERSION = (.+)$/m)?.[1].trim()
const lastBuild = previous.match(/^CURRENT_PROJECT_VERSION = (.+)$/m)?.[1].trim()
const requested = process.env.IOS_BUILD?.trim()

// iOS takes only numbers here: "0.2.0-beta.1" is 0.2.0 to the store.
const marketing = `${major}.${minor}.${patch}`

let build = derived
let how = 'from the version'
if (requested) {
  // CFBundleVersion is one to three whole numbers with periods between.
  if (!/^\d+(\.\d+){0,2}$/.test(requested)) {
    console.error(`error: IOS_BUILD must be one to three whole numbers with periods between, got "${requested}"`)
    process.exit(1)
  }
  build = requested
  how = 'IOS_BUILD'
} else if (lastVersion === marketing && lastBuild && /^\d+$/.test(lastBuild) && Number(lastBuild) > Number(derived)) {
  build = lastBuild
  how = 'kept from the last IOS_BUILD'
}

const xcconfig =
  '// Written by scripts/sync-ios-version.mjs. Do not edit: the version is\n' +
  "// package.json's and the build number is derived from it (or IOS_BUILD).\n" +
  `MARKETING_VERSION = ${marketing}\n` +
  `CURRENT_PROJECT_VERSION = ${build}\n`

if (xcconfig !== previous) writeFileSync(xcconfigPath, xcconfig)
console.log(`iOS MARKETING_VERSION ${marketing}, CURRENT_PROJECT_VERSION ${build} (${how})`)
