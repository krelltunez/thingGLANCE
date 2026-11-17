import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setUpClaudeDesktop, type ClaudeSetupOptions } from './mcpDesktopSetup';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

/** A home with a Claude config folder and an app whose Resources hold the bridge. */
function machine(withBridge = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-claude-')); dirs.push(home);
  const resourcesPath = path.join(home, 'thingGLANCE.app', 'Contents', 'Resources');
  fs.mkdirSync(path.join(resourcesPath, 'mcp-bridge'), { recursive: true });
  if (withBridge) fs.writeFileSync(path.join(resourcesPath, 'mcp-bridge', 'bridge.js'), '');
  const config = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  const options: ClaudeSetupOptions = {
    platform: 'darwin',
    env: {},
    home,
    execPath: path.join(home, 'thingGLANCE.app', 'Contents', 'MacOS', 'thingGLANCE'),
    resourcesPath,
    connection: () => ({ port: 7910, token: 'tok' }),
    now: () => new Date('2026-11-16T12:00:00.000Z'),
  };
  return { home, config, options, bridge: path.join(resourcesPath, 'mcp-bridge', 'bridge.js') };
}
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));

describe('Set up Claude Desktop', () => {
  it('writes a config where there was none, with no backup to make', () => {
    const m = machine();
    const r = setUpClaudeDesktop(m.options);
    expect(r).toEqual({ ok: true, action: 'created', path: m.config, backupPath: null });
    expect(read(m.config)).toEqual({
      mcpServers: { thingglance: { command: m.options.execPath, args: [m.bridge, '--app', 'thingglance'], env: { ELECTRON_RUN_AS_NODE: '1' } } },
    });
    // Discovery carries the token on an unpackaged Claude: it is not written into the config.
    expect(fs.readFileSync(m.config, 'utf-8')).not.toContain('tok');
  });

  it('adds itself to an existing config, keeps a copy of what was there, and touches nothing else', () => {
    const m = machine();
    fs.mkdirSync(path.dirname(m.config), { recursive: true });
    const before = JSON.stringify({ theme: 'dark', mcpServers: { lastglance: { command: 'lg' }, thingglance: { command: 'old' } } });
    fs.writeFileSync(m.config, before);
    const r = setUpClaudeDesktop(m.options);
    const backup = `${m.config}.bak-thingglance-2026-11-16T12-00-00-000Z`;
    expect(r).toEqual({ ok: true, action: 'merged', path: m.config, backupPath: backup });
    expect(fs.readFileSync(backup, 'utf-8')).toBe(before);
    const after = read(m.config);
    expect(after.theme).toBe('dark');
    expect(after.mcpServers.lastglance).toEqual({ command: 'lg' });
    expect(after.mcpServers.thingglance.args).toEqual([m.bridge, '--app', 'thingglance']);
  });

  it('never overwrites a config it cannot read as JSON: it hands over the lines to paste', () => {
    const m = machine();
    fs.mkdirSync(path.dirname(m.config), { recursive: true });
    fs.writeFileSync(m.config, '{ "mcpServers": ');
    const r = setUpClaudeDesktop(m.options);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unparseable');
    expect(JSON.parse(r.manualEntry!).mcpServers.thingglance.args).toEqual([m.bridge, '--app', 'thingglance']);
    expect(fs.readFileSync(m.config, 'utf-8')).toBe('{ "mcpServers": ');
    expect(fs.readdirSync(path.dirname(m.config))).toEqual(['claude_desktop_config.json']);
  });

  it('refuses, and writes nothing, when the build did not bring the bridge', () => {
    const m = machine(false);
    expect(setUpClaudeDesktop(m.options)).toEqual({ ok: false, reason: 'bridge_missing', path: m.config, bridgePath: m.bridge });
    expect(fs.existsSync(m.config)).toBe(false);
  });

  it('has nothing to set up where there is no Claude Desktop', () => {
    const m = machine();
    const r = setUpClaudeDesktop({ ...m.options, platform: 'linux', configPath: path.join(m.home, 'stand-in.json') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unsupported_platform');
    expect(fs.existsSync(path.join(m.home, 'stand-in.json'))).toBe(false);
  });

  it('writes to a stand-in config when given one, never to the one Claude reads', () => {
    const m = machine();
    const standIn = path.join(m.home, 'profile', 'claude_desktop_config.json');
    const r = setUpClaudeDesktop({ ...m.options, configPath: standIn });
    expect(r).toEqual({ ok: true, action: 'created', path: standIn, backupPath: null });
    expect(fs.existsSync(m.config)).toBe(false);
  });

  it('puts the port and the token in the entry only for a packaged Claude Desktop, which cannot see the discovery file', () => {
    const m = machine();
    // The stand-in path has the shape of an MSIX container's, which is what decides it.
    const packaged = path.join(m.home, 'x') + '\\Packages\\Claude_abc\\LocalCache\\Roaming\\Claude\\claude_desktop_config.json';
    const r = setUpClaudeDesktop({ ...m.options, configPath: packaged });
    expect(r.ok).toBe(true);
    expect(read(packaged).mcpServers.thingglance.args).toEqual([m.bridge, '--app', 'thingglance', '--port', '7910', '--token', 'tok']);
  });
});
