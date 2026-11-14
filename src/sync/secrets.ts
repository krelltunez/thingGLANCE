// Where credentials are kept.
//
// On the web they stay in localStorage, as before: a browser has nowhere
// better, and the page's own origin is the boundary.
//
// When a shell supplies a secure store (native/shell.ts), they move there.
// The app reads its config synchronously in many places, and a keystore is
// asynchronous, so the values are held in memory for the session:
//   - hydrateSecrets() runs once at boot, before anything renders or syncs,
//     and fills the memory copy from the secure store;
//   - writeSecret() updates the memory copy at once and writes through.
//
// A keystore is a real device service: it can refuse, and it can hang. The
// rules that follow from that:
//
//   - Every keystore call goes through secureOp(): one at a time, in order,
//     each with a deadline. Nothing waits on a keystore for ever.
//   - Every stored value carries a revision. If the keystore refuses a write,
//     the change is kept in localStorage (the old place) under a ".pending"
//     key with its revision, so it survives the reload that follows, and the
//     next boot moves it across. A failing keystore looks like "works as on
//     the web, moves next time", never like a lost or reverted connection.
//   - At boot the newest revision wins, wherever it is. A stale copy can never
//     overwrite a newer one.
//   - "Could not read the keystore" is not "nothing is stored". That state is
//     reported (secretsUnreadable) so the app can say so and hold local edits
//     for the next launch, instead of behaving as if it was never connected.

import { secureStore, type SecureStore } from '@/native/shell'

// Every key whose value holds a credential.
export const VAULT_CONFIG_KEY = 'thingglance-vault-config'
export const SECRET_KEYS: readonly string[] = [VAULT_CONFIG_KEY]

// How long one keystore call may take. Long enough for a cold Android
// Keystore, short enough that a hung one does not look like a dead app.
export const SECURE_OP_TIMEOUT_MS = 4000
const READ_ATTEMPTS = 3

interface Stamped { rev: number; value: string | null }

const held = new Map<string, string>()
const revs = new Map<string, number>()
const unreadable = new Set<string>()
let hydrated = false
const pending = new Set<Promise<void>>()

const plain = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage)
const pendingKey = (key: string): string => `${key}.pending`
const plainGet = (key: string): string | null => { try { return plain()?.getItem(key) ?? null } catch { return null } }
const plainSet = (key: string, value: string): void => { try { plain()?.setItem(key, value) } catch { /* storage unavailable */ } }
const plainRemove = (key: string): void => { try { plain()?.removeItem(key) } catch { /* nothing to clear */ } }

// ── The keystore, one call at a time ─────────────────────────────────────────

let chain: Promise<unknown> = Promise.resolve()

// Runs `run` against the secure store after every call queued before it has
// settled, and rejects if it takes longer than the deadline. Order matters: a
// remove followed by a set must never land the other way round, and not every
// keystore serialises its own calls.
export function secureOp<T>(run: (store: SecureStore) => Promise<T>, timeoutMs = SECURE_OP_TIMEOUT_MS): Promise<T> {
  const next = chain.then(() => {
    const store = secureStore()
    if (!store) throw new Error('no secure store')
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('secure store timed out')), timeoutMs)
      Promise.resolve().then(() => run(store)).then(
        (v) => { clearTimeout(timer); resolve(v) },
        (e) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))) },
      )
    })
  })
  // The queue moves on whether this call worked or not.
  chain = next.catch(() => {})
  return next
}

// Counts a write towards flushSecretWrites(). It never rejects: whoever
// started the write decides what a failure means.
export function trackSecureWrite(write: Promise<unknown>): void {
  const guarded = write.then(() => {}, () => {})
  pending.add(guarded)
  void guarded.finally(() => pending.delete(guarded))
}

// ── Revisions ────────────────────────────────────────────────────────────────

function nextRev(key: string): number {
  const rev = Math.max(Date.now(), (revs.get(key) ?? 0) + 1)
  revs.set(key, rev)
  return rev
}

// A value as the keystore holds it. Anything that is not our envelope is a
// bare value from before revisions existed: revision 0.
function unwrap(raw: string | null): Stamped | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Stamped> | null
    if (parsed && typeof parsed === 'object' && typeof parsed.rev === 'number' && 'value' in parsed && (parsed.value === null || typeof parsed.value === 'string')) {
      return { rev: parsed.rev, value: parsed.value }
    }
  } catch { /* a bare value */ }
  return { rev: 0, value: raw }
}
const wrap = (s: Stamped): string => JSON.stringify(s)

// What localStorage still holds for a key when a keystore is in use: a change
// the keystore refused (".pending", which may record a removal), or a value
// from before the keystore existed (revision 0).
function plainCopy(key: string): Stamped | null {
  const waiting = unwrap(plainGet(pendingKey(key)))
  const legacy = plainGet(key)
  if (waiting && waiting.rev > 0) return waiting
  return legacy !== null ? { rev: 0, value: legacy } : null
}
function dropPlainCopies(key: string): void {
  plainRemove(key)
  plainRemove(pendingKey(key))
}

async function readKept(key: string): Promise<Stamped | null> {
  let failure: unknown
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
    try {
      return unwrap(await secureOp((store) => store.get(key)))
    } catch (err) {
      failure = err
      // A hang will hang again; only a refusal is worth another try.
      if (err instanceof Error && err.message === 'secure store timed out') break
    }
  }
  throw failure
}

// ── Boot ─────────────────────────────────────────────────────────────────────

export async function hydrateSecrets(): Promise<void> {
  hydrated = true
  if (!secureStore()) return
  for (const key of SECRET_KEYS) {
    const local = plainCopy(key)
    let kept: Stamped | null
    try {
      kept = await readKept(key)
    } catch {
      // The keystore did not answer. A copy in localStorage is the newest
      // thing we know of, so run on it; with none, we do not know.
      if (local) { revs.set(key, local.rev); if (local.value !== null) held.set(key, local.value) }
      else unreadable.add(key)
      continue
    }
    const localWins = !!local && (!kept || local.rev > kept.rev)
    const winner = localWins ? local : kept
    if (winner) { revs.set(key, winner.rev); if (winner.value !== null) held.set(key, winner.value) }
    if (!local) continue
    if (!localWins) { dropPlainCopies(key); continue }
    // Move the newer local copy across. Only once the keystore has it is the
    // localStorage copy removed; on a refusal it stays for the next boot.
    try {
      const stamped: Stamped = { rev: local.rev, value: local.value }
      await secureOp((store) => (stamped.value === null ? store.remove(key) : store.set(key, wrap(stamped))))
      dropPlainCopies(key)
    } catch { /* runs from memory this session, moves next time */ }
  }
}

// True when the keystore could not be read at boot and nothing else says what
// was stored. The device may well be connected; this session cannot tell.
export const secretsUnreadable = (): boolean => unreadable.size > 0

// ── Read and write ───────────────────────────────────────────────────────────

export function readSecret(key: string): string | null {
  if (!secureStore()) return plainGet(key)
  // Before hydration there is nothing in memory yet. Answer from the old
  // place rather than "not configured": boot order is main.tsx's job, and a
  // mistake there should not look like a lost connection.
  if (!hydrated) return held.get(key) ?? plainCopy(key)?.value ?? null
  return held.get(key) ?? null
}

export function writeSecret(key: string, value: string | null): void {
  if (!secureStore()) {
    if (value === null) plainRemove(key)
    else plainSet(key, value)
    return
  }
  const stamped: Stamped = { rev: nextRev(key), value }
  // The user has just said what the value is: no longer unknown.
  unreadable.delete(key)
  if (value === null) held.delete(key)
  else held.set(key, value)
  plainRemove(key)
  // A removal holds no secret, so it is recorded in localStorage up front and
  // survives even a crash before the keystore answers. A value is only ever
  // written there if the keystore refuses it.
  if (value === null) plainSet(pendingKey(key), wrap(stamped))
  const write = secureOp((store) => (value === null ? store.remove(key) : store.set(key, wrap(stamped)))).then(
    () => {
      // A later write may have started meanwhile; its own record must stay.
      if (unwrap(plainGet(pendingKey(key)))?.rev === stamped.rev || revs.get(key) === stamped.rev) plainRemove(pendingKey(key))
    },
    (err) => {
      if (revs.get(key) !== stamped.rev) return
      plainSet(pendingKey(key), wrap(stamped))
      console.warn('[thingglance] the secure store refused a write; kept in local storage until the next start:', err instanceof Error ? err.message : err)
    },
  )
  trackSecureWrite(write)
}

// Resolves once every write-through has reached the secure store, or been
// refused and kept in localStorage instead. Either way it is safe to reload.
// It cannot hang: every keystore call has a deadline.
export function flushSecretWrites(): Promise<void> {
  return Promise.all([...pending]).then(() => (pending.size > 0 ? flushSecretWrites() : undefined))
}

// For tests.
export function resetSecretsForTests(): void {
  held.clear()
  revs.clear()
  unreadable.clear()
  pending.clear()
  chain = Promise.resolve()
  hydrated = false
}
