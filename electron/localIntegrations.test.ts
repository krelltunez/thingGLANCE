import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyTransition, assistantIndicator, DEFAULT_LOCAL_INTEGRATIONS, DEFAULT_MCP_PORT, integrationsView, listenerEffects, loadLocalIntegrations,
  LOCAL_INTEGRATIONS_FILE, mcpGates, normalizeConfig, saveLocalIntegrations, STREAM_DECK_PORT,
  type LocalIntegrationsConfig, type TransitionResult,
} from './localIntegrations';

const dirs: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-li-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);
const NOW = '2026-11-16T18:00:00.000Z';
let tokens: string[] = [];
const deps = { now: () => NOW, newToken: () => tokens.shift() ?? 'f'.repeat(64) };
afterEach(() => { tokens = []; });

const ok = (r: TransitionResult): LocalIntegrationsConfig => {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.config;
};
const off = (): LocalIntegrationsConfig => normalizeConfig({});
const on = (): LocalIntegrationsConfig => {
  tokens = [TOKEN_A];
  return ok(applyTransition(off(), { type: 'set-mcp-read-tier', tier: 'on', consentConfirmed: true }, deps));
};
const withWrites = (): LocalIntegrationsConfig => ok(applyTransition(on(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true }, deps));
const idle = { mcp: { running: false, error: null }, streamDeck: { running: false, error: null } };

describe('the defaults', () => {
  it('turn everything off, with no token, on the ports reserved for thingGLANCE', () => {
    expect(off()).toEqual(DEFAULT_LOCAL_INTEGRATIONS);
    expect(mcpGates(off())).toEqual({ bound: false, includeWrites: false });
    expect([DEFAULT_MCP_PORT, STREAM_DECK_PORT]).toEqual([7910, 7911]);
  });
});

describe('reading the file', () => {
  it('reads a missing file as the defaults, and round-trips a saved one owner-only', () => {
    const d = temp();
    expect(loadLocalIntegrations(d)).toEqual({ config: DEFAULT_LOCAL_INTEGRATIONS, recovered: false });
    const config = withWrites();
    expect(saveLocalIntegrations(d, config)).toBe(true);
    expect(loadLocalIntegrations(d)).toEqual({ config, recovered: false });
    if (process.platform !== 'win32') expect(fs.statSync(path.join(d, LOCAL_INTEGRATIONS_FILE)).mode & 0o777).toBe(0o600);
  });

  it('sets a corrupt file aside and fails closed', () => {
    const d = temp();
    const file = path.join(d, LOCAL_INTEGRATIONS_FILE);
    for (const text of ['{not json', '[]', 'null']) {
      fs.writeFileSync(file, text);
      expect(loadLocalIntegrations(d)).toEqual({ config: DEFAULT_LOCAL_INTEGRATIONS, recovered: true });
      expect(fs.readFileSync(`${file}.corrupt`, 'utf-8')).toBe(text);
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  it('never reads a field into a state its consent does not back', () => {
    // On, but nobody accepted the dialog; on with a token that is not one; writes with reading off.
    expect(normalizeConfig({ mcp: { readTier: 'on', token: TOKEN_A } }).mcp.readTier).toBe('off');
    expect(normalizeConfig({ mcp: { readTier: 'on', token: 'short', consentAcceptedAt: NOW } }).mcp.readTier).toBe('off');
    expect(normalizeConfig({ mcp: { readTier: 'off', writesEnabled: true, writesConsentAcceptedAt: NOW } }).mcp.writesEnabled).toBe(false);
    expect(normalizeConfig({ mcp: { readTier: 'on', token: TOKEN_A, consentAcceptedAt: NOW, writesEnabled: true } }).mcp.writesEnabled).toBe(false);
    expect(normalizeConfig({ mcp: { readTier: 'everything' } }).mcp.readTier).toBe('off');
    expect(normalizeConfig({ mcp: { portOverride: 70000 }, streamDeck: { enabled: 'yes' } })).toEqual(DEFAULT_LOCAL_INTEGRATIONS);
  });
});

describe('turning reading on', () => {
  it('needs the consent dialog, and makes the token then', () => {
    expect(applyTransition(off(), { type: 'set-mcp-read-tier', tier: 'on' }, deps)).toEqual({ ok: false, error: 'consent_required' });
    const config = on();
    expect(config.mcp).toMatchObject({ readTier: 'on', token: TOKEN_A, consentAcceptedAt: NOW, writesEnabled: false });
    expect(mcpGates(config)).toEqual({ bound: true, includeWrites: false });
  });

  it('asks again after being turned off, and keeps the token', () => {
    const stopped = ok(applyTransition(on(), { type: 'set-mcp-read-tier', tier: 'off' }, deps));
    expect(stopped.mcp.readTier).toBe('off');
    expect(stopped.mcp.token).toBe(TOKEN_A);
    expect(applyTransition(stopped, { type: 'set-mcp-read-tier', tier: 'on' }, deps)).toEqual({ ok: false, error: 'consent_required' });
  });

  it('turns changes off with the server', () => {
    const stopped = ok(applyTransition(withWrites(), { type: 'set-mcp-read-tier', tier: 'off' }, deps));
    expect(stopped.mcp.writesEnabled).toBe(false);
  });
});

describe('allowing changes', () => {
  it('needs reading on and its own consent', () => {
    expect(applyTransition(off(), { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true }, deps)).toEqual({ ok: false, error: 'read_tier_required' });
    expect(applyTransition(on(), { type: 'set-mcp-writes', enabled: true }, deps)).toEqual({ ok: false, error: 'writes_consent_required' });
    expect(withWrites().mcp).toMatchObject({ writesEnabled: true, writesConsentAcceptedAt: NOW });
    expect(mcpGates(withWrites())).toEqual({ bound: true, includeWrites: true });
  });

  it('turns off without asking anything', () => {
    expect(ok(applyTransition(withWrites(), { type: 'set-mcp-writes', enabled: false }, deps)).mcp.writesEnabled).toBe(false);
  });
});

describe('the token and the port', () => {
  it('rotates the token', () => {
    const config = on();
    tokens = [TOKEN_B];
    expect(ok(applyTransition(config, { type: 'rotate-token' }, deps)).mcp.token).toBe(TOKEN_B);
  });

  it('takes a port override, refuses a bad one and the Stream Deck port', () => {
    expect(ok(applyTransition(on(), { type: 'set-mcp-port', port: 8123 }, deps)).mcp.portOverride).toBe(8123);
    expect(ok(applyTransition(on(), { type: 'set-mcp-port', port: DEFAULT_MCP_PORT }, deps)).mcp.portOverride).toBeNull();
    expect(ok(applyTransition(on(), { type: 'set-mcp-port', port: null }, deps)).mcp.portOverride).toBeNull();
    expect(applyTransition(on(), { type: 'set-mcp-port', port: 0 }, deps)).toEqual({ ok: false, error: 'invalid_port' });
    expect(applyTransition(on(), { type: 'set-mcp-port', port: STREAM_DECK_PORT }, deps)).toEqual({ ok: false, error: 'port_reserved' });
  });
});

describe('anything else', () => {
  it('that comes over IPC is refused', () => {
    for (const action of [null, 'on', {}, { type: 'delete-everything' }, { type: 'set-mcp-read-tier', tier: 'all' }, { type: 'set-stream-deck', enabled: 'yes' }]) {
      expect(applyTransition(off(), action, deps)).toEqual({ ok: false, error: 'invalid_action' });
    }
  });

  it('never changes the config it was given', () => {
    const before = on();
    const copy = JSON.parse(JSON.stringify(before));
    applyTransition(before, { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true }, deps);
    applyTransition(before, { type: 'set-stream-deck', enabled: true }, deps);
    expect(before).toEqual(copy);
  });
});

describe('what a change does to the listeners', () => {
  it('starts and stops MCP on binding, restarts it on a port change while bound only', () => {
    expect(listenerEffects(off(), on()).mcp).toBe('start');
    expect(listenerEffects(on(), off()).mcp).toBe('stop');
    expect(listenerEffects(on(), withWrites()).mcp).toBe('none');
    expect(listenerEffects(on(), ok(applyTransition(on(), { type: 'set-mcp-port', port: 8123 }, deps))).mcp).toBe('restart');
    expect(listenerEffects(off(), ok(applyTransition(off(), { type: 'set-mcp-port', port: 8123 }, deps))).mcp).toBe('none');
  });

  it('starts and stops Stream Deck with its toggle, independent of MCP', () => {
    const deck = ok(applyTransition(off(), { type: 'set-stream-deck', enabled: true }, deps));
    expect(listenerEffects(off(), deck)).toEqual({ mcp: 'none', streamDeck: 'start' });
    expect(listenerEffects(deck, off())).toEqual({ mcp: 'none', streamDeck: 'stop' });
  });
});

describe('what Settings is shown', () => {
  it('resolves the ports and the endpoint', () => {
    const view = integrationsView(ok(applyTransition(on(), { type: 'set-mcp-port', port: 8123 }, deps)), idle);
    expect(view.mcp).toMatchObject({ readTier: 'on', port: 8123, portOverride: 8123, endpoint: 'http://127.0.0.1:8123/mcp', token: TOKEN_A });
    expect(view.streamDeck).toMatchObject({ enabled: false, port: 7911 });
  });

  it('is green while the server runs, and nothing when it is off or could not start', () => {
    const running = { running: true, error: null };
    expect(assistantIndicator({ readTier: 'on', writesEnabled: false, writesPaused: false, status: running }, 0)).toBe('on');
    expect(assistantIndicator({ readTier: 'on', writesEnabled: false, writesPaused: false, status: { running: false, error: 'port_in_use' } }, 0)).toBe('off');
    expect(assistantIndicator({ readTier: 'off', writesEnabled: false, writesPaused: false, status: idle.mcp }, 0)).toBe('off');
  });

  it('is blue while there are changes to undo, even with the server turned off since', () => {
    expect(assistantIndicator({ readTier: 'off', writesEnabled: false, writesPaused: false, status: idle.mcp }, 2)).toBe('undo');
  });

  it('is red while changes are paused, over the other two', () => {
    expect(assistantIndicator({ readTier: 'on', writesEnabled: true, writesPaused: true, status: { running: true, error: null } }, 3)).toBe('paused');
  });

  it('comes with the Settings view', () => {
    expect(integrationsView(on(), { ...idle, mcp: { running: true, error: null } }, { undoable: 1 }).assistant).toBe('undo');
    expect(integrationsView(on(), { ...idle, mcp: { running: true, error: null } }).assistant).toBe('on');
  });
});
