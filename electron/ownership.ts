// "Owned since" on the desktop (docs/release.md): the record that this copy of
// the app was bought. Nothing checks it. It is written so that people who paid
// can be recognised later if the price model ever changes.
//
// Only a store build knows it was bought, and the one desktop store build is
// the Mac App Store's. Its date is the day that build first ran on this Mac:
// the nearest thing to a purchase date the app can see for itself. The direct
// builds (free downloads) record nothing. Android's half is
// android/.../ownership/Ownership.kt, and the rule is the same there: the
// record already held stands, whatever it says.
//
// Kept in the data folder; the page copies it into the vault
// (src/native/ownership.ts), which is what carries it to a new machine.

import fs from 'node:fs';
import { writeFileAtomicSync } from './atomicWrite.js';

export const OWNED_FILE = 'owned.json';
export const MAC_APP_STORE = 'mas';

export interface OwnedFact {
  /** Epoch ms. */
  since: number;
  store: string;
  version: string;
}

function parseFact(v: unknown): OwnedFact | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  if (typeof f.since !== 'number' || !Number.isFinite(f.since) || f.since <= 0) return null;
  if (typeof f.store !== 'string' || !f.store) return null;
  return { since: f.since, store: f.store, version: typeof f.version === 'string' ? f.version : '' };
}

/** The record to hold from here on: the one already held, or a new one when a store build is running. Null when neither. */
export function settleOwnership(existing: OwnedFact | null, isStoreBuild: boolean, now: number, version: string): OwnedFact | null {
  return existing ?? (isStoreBuild && now > 0 ? { since: now, store: MAC_APP_STORE, version } : null);
}

export function readOwnership(file: string): OwnedFact | null {
  try {
    return parseFact(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch {
    return null;
  }
}

/** Reads the record, writing it first if this is the start that finds out. */
export function ensureOwnership(o: { file: string; isStoreBuild: boolean; now: number; version: string }): OwnedFact | null {
  const existing = readOwnership(o.file);
  const fact = settleOwnership(existing, o.isStoreBuild, o.now, o.version);
  if (fact && !existing) {
    try { writeFileAtomicSync(o.file, JSON.stringify(fact)); } catch { /* asked again on the next start */ }
  }
  return fact;
}
