// What a shell brings that the browser does not have. Today nothing registers
// one, so every getter here answers "not available" and the app behaves
// exactly as a web page. A Capacitor or Electron shell supplies a bridge
// before the app boots, and the two seams below start using it:
//
//   fetch        the shell's own HTTP stack. Electron's renderer is allowed no
//                request of its own (the main process makes them), and an
//                Android headless refresh has no browser fetch worth trusting.
//                See sync/shellFetch.ts.
//   eventStream  the vault's live stream, read natively and passed in. Without
//                one a shell simply has no live updates; polling covers it.
//   secureStore  the platform keystore (Android Keystore, iOS Keychain,
//                Electron safeStorage), so the vault token and the encryption
//                root key are not left in WebView storage where anything with
//                file access can read them. See sync/secrets.ts.
//
// Two ways to supply it, whichever suits the shell: call registerShell() from
// its bootstrap, or set window.thingglanceShell from a preload script. It has
// to be there before main.tsx runs hydrateSecrets().

export interface SecureStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

// The vault's live event stream, read by the shell. A transport that hands
// back whole responses cannot stream, so a shell that carries the app's
// requests reads this one itself and passes each message in. The messages are
// the sibling apps' shapes (native/vaultSse.ts); sync/vaultEventStream.ts
// turns them into the same nudges the web reader produces.
export interface ShellEventStream {
  start(connection: { vaultUrl: string; vaultToken: string; accountId: string }): Promise<void> | void
  stop(): Promise<void> | void
  // Every reader message. Answers the unsubscribe.
  listen(listener: (message: unknown) => void): () => void
}

export interface ShellBridge {
  fetch?: typeof fetch
  secureStore?: SecureStore
  eventStream?: ShellEventStream
}

let registered: ShellBridge | null = null

export function registerShell(bridge: ShellBridge | null): void {
  registered = bridge
}

export function shellBridge(): ShellBridge | null {
  if (registered) return registered
  if (typeof window === 'undefined') return null
  return (window as unknown as { thingglanceShell?: ShellBridge }).thingglanceShell ?? null
}

export const secureStore = (): SecureStore | null => shellBridge()?.secureStore ?? null

// True when a shell carries the app's requests. "Is this a browser tab" has
// to be answered the same way everywhere: by the platform (native/platform.ts:
// shell()) or by a bridge being present, whichever says so first.
export const hasShellTransport = (): boolean => typeof shellBridge()?.fetch === 'function'
