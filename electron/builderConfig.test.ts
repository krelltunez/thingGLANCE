// electron-builder.config.cjs, checked without running electron-builder: CI's
// pull-request path never packages every target, so a malformed config would
// first meet reality at release time. After lastGLANCE's
// electron/builderConfig.test.ts and dayGLANCE's builderConfigSchema.test.ts
// (krelltunez/dayGLANCE@8d72008), which validates against electron-builder's own
// schema for the same reason (an artifactName inside a target entry killed a
// release build with an error pointing at the wrong key).

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DEEP_LINK_SCHEME } from './deepLink';

const require = createRequire(import.meta.url);
const root = path.resolve(__dirname, '..');

/** A bare specifier's package name: '@scope/name' or 'name'. */
const packageOf = (spec: string) => spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');

/**
 * The packages main loads at run time: every value import (not `import type`)
 * in electron/*.ts outside the tests, other than electron and node builtins,
 * with their dependencies and peer dependencies followed transitively
 * (optional peers only when installed).
 */
function mainRuntimeClosure(): Set<string> {
  const seeds = readdirSync(path.join(root, 'electron'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .flatMap((f) => [...readFileSync(path.join(root, 'electron', f), 'utf-8').matchAll(/^import (?!type )[^'"]*from '([^'.][^']*)'/gm)].map((m) => m[1]))
    .filter((spec) => spec !== 'electron' && !spec.startsWith('node:'))
    .map(packageOf);
  const closure = new Set<string>();
  const queue = [...seeds];
  while (queue.length) {
    const name = queue.shift()!;
    if (closure.has(name)) continue;
    closure.add(name);
    const pkg = JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf-8'));
    // An optional peer is loaded only if installed; one that is not is not a dependency.
    const optional = new Set(Object.entries(pkg.peerDependenciesMeta ?? {}).filter(([, m]) => (m as { optional?: boolean }).optional).map(([n]) => n));
    const peers = Object.keys(pkg.peerDependencies ?? {}).filter((n) => !optional.has(n) || existsSync(path.join(root, 'node_modules', n, 'package.json')));
    queue.push(...Object.keys(pkg.dependencies ?? {}), ...peers);
  }
  return closure;
}

function loadConfig() {
  delete require.cache[require.resolve('../electron-builder.config.cjs')];
  return require('../electron-builder.config.cjs');
}

describe('electron-builder.config.cjs', () => {
  const config = loadConfig();

  it('validates against electron-builder’s own schema', () => {
    const Ajv = require('ajv');
    const schema = require('app-builder-lib/scheme.json');
    const check = new Ajv({ allErrors: true, strict: false, verbose: true }).compile(schema);
    const ok = check(config);
    const detail = (check.errors ?? [])
      .map((e: { instancePath?: string; dataPath?: string; message?: string }) => `${e.instancePath ?? e.dataPath} ${e.message}`)
      .join('\n');
    expect(ok, detail).toBe(true);
  });

  it('target entries carry only target and arch, the keys the schema allows', () => {
    for (const platform of ['mac', 'win', 'linux']) {
      for (const t of (config[platform]?.target ?? []) as Record<string, unknown>[]) {
        for (const key of Object.keys(t)) {
          expect(['target', 'arch'], `${platform}.target has illegal key "${key}"`).toContain(key);
        }
      }
    }
  });

  it('builds both architectures on macOS and Linux, spelled out', () => {
    // An omitted arch means the build host's only: Linux shipped x64-only
    // that way in dayGLANCE for three releases.
    for (const platform of ['mac', 'linux']) {
      for (const t of config[platform].target as { target: string; arch: string[] }[]) {
        expect(t.arch, `${platform} ${t.target}`).toEqual(['x64', 'arm64']);
      }
    }
  });

  it('ships the renderer bundle and main, and of node_modules only what main imports at run time', () => {
    expect(config.files).toEqual(expect.arrayContaining(['dist/**/*', 'dist-electron/**/*', '!**/*.map', '!node_modules/**/*']));
    // Every package main imports ships whole, with everything it imports in
    // turn (dependencies, and peer dependencies, which npm installs): a
    // package left out is a crash at run time that no test before packaging sees.
    const whole = config.files
      .filter((f: string) => f.startsWith('node_modules/'))
      .map((f: string) => /^node_modules\/((?:@[^/]+\/)?[^/]+)\/\*\*\/\*$/.exec(f)?.[1] ?? f);
    expect([...whole].sort()).toEqual([...mainRuntimeClosure()].sort());
  });

  it('points at icons that exist', () => {
    for (const icon of [config.mac.icon, config.win.icon, config.linux.icon]) {
      expect(existsSync(path.join(root, icon)), icon).toBe(true);
    }
  });

  it('lists every shipped language in the macOS bundle', () => {
    const locales = readdirSync(path.join(root, 'src/locales'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(locales).toContain('en');
    expect(config.mac.electronLanguages).toEqual(locales);
    expect(config.mac.extendInfo.CFBundleLocalizations).toHaveLength(locales.length);
  });

  it('gives the deb the metadata it fails without', () => {
    expect(config.linux.maintainer).toMatch(/<.+@.+>/);
    expect(config.linux.category).toBeTruthy();
  });

  it('signs ad-hoc without a certificate, and notarizes through the afterSign hook', () => {
    expect(config.mac.identity).toBeNull();
    expect(config.mac.hardenedRuntime).toBe(false);
    expect(config.mac.notarize).toBe(false);
    expect(config.afterSign).toBe('./scripts/notarize.cjs');
    expect(existsSync(path.join(root, 'scripts/notarize.cjs'))).toBe(true);
    for (const f of [config.mac.entitlements, config.mas.entitlements, config.mas.entitlementsInherit]) {
      expect(existsSync(path.join(root, f)), f).toBe(true);
    }
  });

  it('with a Developer ID certificate, signs with Hardened Runtime', () => {
    process.env.CSC_LINK = 'x';
    try {
      const signed = loadConfig();
      expect(signed.mac.identity).toBeUndefined();
      expect(signed.mac.hardenedRuntime).toBe(true);
    } finally {
      delete process.env.CSC_LINK;
    }
  });

  it('the MAS build takes a rising build number and a keychain identity', () => {
    process.env.THINGGLANCE_MAS_BUILD = '1';
    try {
      const mas = loadConfig();
      expect(mas.mac.identity).toBeUndefined();
      expect(mas.buildVersion).toMatch(/^\d{8}\.\d{4}$/);
      expect(mas.mas.hardenedRuntime).toBe(false);
      expect(mas.mas.provisioningProfile).toBe('electron/thingglance.mas.provisionprofile');
    } finally {
      delete process.env.THINGGLANCE_MAS_BUILD;
    }
    expect(config.buildVersion).toBeUndefined();
  });

  it('gives the MAS app the sandbox, and nothing it does not use', () => {
    const plist = readFileSync(path.join(root, 'electron/entitlements.mas.plist'), 'utf-8');
    // The server entitlement is the MCP and Stream Deck listeners', on 127.0.0.1 only.
    for (const key of ['com.apple.security.app-sandbox', 'com.apple.security.network.client', 'com.apple.security.network.server', 'com.apple.security.files.user-selected.read-write']) {
      expect(plist, key).toContain(key);
    }
    // No purchases inside the app (it is paid up front), and no iCloud.
    expect(plist).not.toContain('in-app-payments');
    expect(plist).not.toContain('icloud');
    const inherit = readFileSync(path.join(root, 'electron/entitlements.mas.inherit.plist'), 'utf-8');
    expect(inherit).toContain('com.apple.security.inherit');
  });

  it('keeps the provisioning profile out of git', () => {
    expect(readFileSync(path.join(root, '.gitignore'), 'utf-8')).toContain('electron/*.provisionprofile');
  });

  it('ships the tray icons main loads', () => {
    expect(config.extraResources).toEqual([{ from: 'electron/resources/tray', to: 'tray' }]);
    for (const name of ['trayTemplate.png', 'trayTemplate@2x.png', 'tray.png', 'tray@2x.png']) {
      expect(existsSync(path.join(root, 'electron/resources/tray', name)), name).toBe(true);
    }
  });

  it('ships the MCP bridge on direct macOS and Windows builds, where the setup points Claude at it', () => {
    const bridge = { from: 'node_modules/@glance-apps/mcp-bridge', to: 'mcp-bridge' };
    expect(config.mac.extraResources).toEqual([bridge]);
    expect(config.win.extraResources).toEqual([bridge]);
    expect(config.linux.extraResources).toBeUndefined();
    // The version shipped knows thingGLANCE: --app thingglance, which the entry passes.
    const pkg = JSON.parse(readFileSync(path.join(root, bridge.from, 'package.json'), 'utf-8'));
    expect(pkg.version).toBe('0.3.0');
    expect(readFileSync(path.join(root, bridge.from, 'src/apps.js'), 'utf-8')).toContain("id: 'thingglance'");
    expect(existsSync(path.join(root, bridge.from, 'bridge.js'))).toBe(true);
    // The bridge is a pipe with no dependencies: what is copied is all it needs.
    expect(pkg.dependencies).toBeUndefined();
    // Direct builds carry the setup modules.
    expect(config.files.some((f: string) => f.includes('mcpDesktop'))).toBe(false);
  });

  it('leaves the Claude Desktop setup and the bridge out of the MAS build', () => {
    process.env.THINGGLANCE_MAS_BUILD = '1';
    try {
      const mas = loadConfig();
      // No bridge on MAS: the mac options it merges over carry none.
      expect(mas.mac.extraResources).toEqual([]);
      expect(mas.mas.extraResources).toBeUndefined();
      // At the top level, where negations compose.
      expect(mas.files).toEqual(expect.arrayContaining(['!dist-electron/mcpDesktopSetup*', '!dist-electron/mcpDesktopConfig*']));
      expect(mas.mas.files).toBeUndefined();
    } finally {
      delete process.env.THINGGLANCE_MAS_BUILD;
    }
  });

  it('loads the setup only when asked, so a build without the module still starts', () => {
    const sources = readdirSync(path.join(root, 'electron')).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('mcpDesktop'));
    for (const f of sources) {
      const text = readFileSync(path.join(root, 'electron', f), 'utf-8');
      expect(/^import [^\n]*from '\.\/mcpDesktop(Setup|Config)\.js'/m.test(text), `${f} imports the setup statically`).toBe(false);
    }
    expect(readFileSync(path.join(root, 'electron/main.ts'), 'utf-8')).toContain("await import('./mcpDesktopSetup.js')");
  });

  it('registers the thingglance:// scheme the app handles', () => {
    expect(config.protocols).toEqual([{ name: 'thingGLANCE', schemes: [DEEP_LINK_SCHEME] }]);
  });

  it('uses one application id on every platform, the Mac App Store included', () => {
    expect(config.appId).toBe('com.thingglance.app');
    process.env.THINGGLANCE_MAS_BUILD = '1';
    try { expect(loadConfig().appId).toBe('com.thingglance.app'); } finally { delete process.env.THINGGLANCE_MAS_BUILD; }
  });
});
