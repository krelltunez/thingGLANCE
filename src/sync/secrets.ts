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
//   - writeSecret() updates the memory copy at once and writes through;
//   - nothing secret is written to localStorage again.
//
// A value still sitting in localStorage when a secure store first appears (a
// shell build that shipped before its keystore plugin was wired) is moved
// across at boot. lastGLANCE's shim is the model, including the order of that
// move: the plaintext copy is removed only after the secure write succeeds,
// so a failing keystore looks like "works as before, moves next time" and
// never like wiped settings.

import { secureStore } from '@/native/shell'

// Every key whose value holds a credential.
export const VAULT_CONFIG_KEY = 'thingglance-vault-config'
export const SECRET_KEYS: readonly string[] = [VAULT_CONFIG_KEY]

const held = new Map<string, string>()
let hydrated = false
const pending = new Set<Promise<void>>()

const plain = (): Storage | null => (typeof localStorage === 'undefined' ? null : localStorage)

function track(write: Promise<void>): void {
  // A failed write-through costs nothing this session (memory still serves
  // it). At worst the next launch asks for the connection again.
  const guarded = write.catch(() => {})
  pending.add(guarded)
  void guarded.finally(() => pending.delete(guarded))
}

export async function hydrateSecrets(): Promise<void> {
  const store = secureStore()
  hydrated = true
  if (!store) return
  for (const key of SECRET_KEYS) {
    try {
      const legacy = plain()?.getItem(key) ?? null
      if (legacy !== null) {
        held.set(key, legacy)
        await store.set(key, legacy)
        plain()?.removeItem(key)
        continue
      }
      const value = await store.get(key)
      if (value !== null) held.set(key, value)
    } catch {
      // The keystore refused. With a plaintext copy present it is already in
      // memory and still in place, so the app behaves as before.
    }
  }
}

export function readSecret(key: string): string | null {
  if (!secureStore()) return plain()?.getItem(key) ?? null
  // Before hydration there is nothing in memory yet. Answer from the old
  // place rather than "not configured": boot order is main.tsx's job, and a
  // mistake there should not look like a lost connection.
  if (!hydrated) return held.get(key) ?? plain()?.getItem(key) ?? null
  return held.get(key) ?? null
}

export function writeSecret(key: string, value: string | null): void {
  const store = secureStore()
  if (!store) {
    if (value === null) plain()?.removeItem(key)
    else plain()?.setItem(key, value)
    return
  }
  if (value === null) {
    held.delete(key)
    track(store.remove(key))
    plain()?.removeItem(key)
  } else {
    held.set(key, value)
    track(store.set(key, value))
  }
}

// Resolves once every write-through has reached the secure store. Await it
// before tearing the page down: a connection change ends in a reload.
export function flushSecretWrites(): Promise<void> {
  return Promise.all([...pending]).then(() => undefined)
}

// For tests.
export function resetSecretsForTests(): void {
  held.clear()
  pending.clear()
  hydrated = false
}
