// The one way out to the network.
//
// Every request the app makes goes through here, so a shell can substitute
// its own transport in one place (native/shell.ts) and nothing is left making
// requests the shell cannot see or is not allowed to make:
//
//   shellFetchImpl()  what the vault client and the sync engines are given as
//                     `fetchImpl`. Undefined when no shell supplies one, which
//                     leaves them on the platform's fetch, as on the web.
//   netFetch()        for the app's own direct requests.
//
// shellFetch.test.ts fails if a bare fetch() or an engine built without
// `fetchImpl` appears anywhere else.
//
// The one exception is the vault's event stream on the web
// (sync/vaultEventStream.ts): it needs a response that streams, which a shell
// transport that hands back whole bodies cannot give. It only runs when there
// is no shell (detectSseTransport), and a shell brings its own reader.

import { shellBridge } from '@/native/shell'

export function shellFetchImpl(): typeof fetch | undefined {
  return shellBridge()?.fetch
}

export const netFetch: typeof fetch = (input, init) => (shellFetchImpl() ?? globalThis.fetch)(input, init)
