#!/usr/bin/env node
// From lastGLANCE scripts/verify-mas-compileout.mjs (krelltunez/lastGLANCE@6fa5d77),
// itself after dayGLANCE's script of the same name.
//
// Checks a BUILT app for what the Mac App Store build must not carry
// (docs/mcp.md, "Mac App Store"): the Claude Desktop setup, which changes
// another app's settings and points it at code to run (App Review Guideline
// 2.5.2). Source checks cannot see a packaging mistake; this reads the archive
// that would ship.
//
//   node scripts/verify-mas-compileout.mjs --mas    <app or resources dir>
//   node scripts/verify-mas-compileout.mjs --direct <app or resources dir>
//
// --mas: the setup modules are not in app.asar, no renderer bundle holds the
// button's code, and the bridge is not in Resources. --direct: all three are
// there (so the check cannot pass by looking in the wrong place), except the
// bridge on Linux, which never carries it. The path is a .app, or the folder
// holding app.asar (dist-app/linux-unpacked/resources, win-unpacked/resources).
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import asar from '@electron/asar'

const [mode, target] = process.argv.slice(2)
if ((mode !== '--mas' && mode !== '--direct') || !target) {
  console.error('usage: node scripts/verify-mas-compileout.mjs --mas|--direct <app or resources dir>')
  process.exit(2)
}
const resources = target.endsWith('.app') ? path.join(target, 'Contents', 'Resources') : target
const archive = path.join(resources, 'app.asar')
if (!existsSync(archive)) {
  console.error(`no app.asar under ${resources}`)
  process.exit(2)
}

const failures = []
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

const entries = new Set(asar.listPackage(archive, { isPack: false }).map((e) => e.replace(/\\/g, '/')))
const mas = mode === '--mas'
for (const module of ['/dist-electron/mcpDesktopSetup.js', '/dist-electron/mcpDesktopConfig.js']) {
  check(entries.has(module) === !mas, `${module} ${mas ? 'is not' : 'is'} in app.asar`)
}

// The button's code, as the renderer bundle carries it: its translation key.
// __MAS_BUILD__ makes the branch dead code, so the minifier drops the key with
// it. The panel's own key says the bundle read is the right one.
const PANEL_KEY = 'settings.local.mcpHint'
const BUTTON_KEY = 'settings.local.claudeDesktopSetup'
const bundles = [...entries].filter((e) => /^\/dist\/assets\/.*\.js$/.test(e))
check(bundles.length > 0, `renderer bundles found (${bundles.length})`)
const texts = bundles.map((e) => [e, asar.extractFile(archive, e.slice(1)).toString('utf-8')])
check(texts.some(([, t]) => t.includes(PANEL_KEY)), 'the integrations panel is in the renderer bundle')
const carrying = texts.filter(([, t]) => t.includes(BUTTON_KEY)).map(([e]) => e)
check(mas ? carrying.length === 0 : carrying.length > 0, `the Set up Claude Desktop button ${mas ? 'is not' : 'is'} in the renderer bundle${carrying.length ? ` (${carrying.join(', ')})` : ''}`)

// The bridge the setup points Claude at: Resources/mcp-bridge/bridge.js on
// direct macOS and Windows builds, nowhere on MAS or Linux.
const bridge = path.join(resources, 'mcp-bridge', 'bridge.js')
const linux = /linux-unpacked/.test(resources)
const shouldCarry = !mas && !linux
check(existsSync(bridge) === shouldCarry, `the MCP bridge ${shouldCarry ? 'is' : 'is not'} in Resources${linux ? ' (Linux never carries it)' : ''}`)

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log(`\n${mas ? 'Mac App Store' : 'direct'} build carries what it should`)
