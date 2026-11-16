import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAC_APP_STORE, ensureOwnership, readOwnership, settleOwnership } from './ownership';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const file = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-owned-')); dirs.push(d); return path.join(d, 'owned.json'); };
const T = Date.parse('2026-11-16T12:00:00Z');

describe('"owned since" on the desktop', () => {
  it('records nothing for a direct build: a free download is not a purchase', () => {
    expect(settleOwnership(null, false, T, '1.1.0')).toBeNull();
    const f = file();
    expect(ensureOwnership({ file: f, isStoreBuild: false, now: T, version: '1.1.0' })).toBeNull();
    expect(fs.existsSync(f)).toBe(false);
  });

  it('records the Mac App Store build the first time it runs', () => {
    const f = file();
    expect(ensureOwnership({ file: f, isStoreBuild: true, now: T, version: '1.1.0' })).toEqual({ since: T, store: MAC_APP_STORE, version: '1.1.0' });
    expect(readOwnership(f)).toEqual({ since: T, store: 'mas', version: '1.1.0' });
  });

  it('keeps the first record on every later start, and after an update', () => {
    const f = file();
    ensureOwnership({ file: f, isStoreBuild: true, now: T, version: '1.1.0' });
    expect(ensureOwnership({ file: f, isStoreBuild: true, now: T + 86_400_000, version: '1.2.0' })).toEqual({ since: T, store: 'mas', version: '1.1.0' });
  });

  it('keeps a record even when the build now running is not a store one', () => {
    const f = file();
    ensureOwnership({ file: f, isStoreBuild: true, now: T, version: '1.1.0' });
    expect(ensureOwnership({ file: f, isStoreBuild: false, now: T + 1, version: '1.2.0' })?.store).toBe('mas');
  });

  it('reads a missing or mangled file as no record', () => {
    const f = file();
    expect(readOwnership(f)).toBeNull();
    fs.writeFileSync(f, '{oops');
    expect(readOwnership(f)).toBeNull();
    fs.writeFileSync(f, JSON.stringify({ since: 'yesterday', store: 'mas' }));
    expect(readOwnership(f)).toBeNull();
  });
});
