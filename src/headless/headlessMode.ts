// A background refresh: the Android shell loads this same bundle in a WebView
// with no screen, at `index.html?headless=refresh`, to do what the app does
// when it is opened, without being opened. main.tsx runs
// src/headless/headlessRefresh.ts instead of App for it.
//
// There is no Capacitor in that WebView (Capacitor needs an Activity). The
// shell injects `window.ThingGlanceHeadless` instead (android:
// refresh/HeadlessBridge.kt), and this module turns it into the same seams
// every shell uses (native/shell.ts): a transport and a keystore. From there
// on the run is ordinary app code.

import type { SecureStore, ShellBridge } from '@/native/shell'
import { headlessFetch } from './headlessHttp'

export const HEADLESS_PARAM = 'headless'
export const HEADLESS_REFRESH = 'refresh'

// Everything a run may ask of the shell, and nothing more: a feature that
// reached for anything else finds no method, not a side effect. Keep equal to
// HeadlessBridge.kt; headlessRefresh.test.ts holds the run to it.
export const HEADLESS_BRIDGE_METHODS = Object.freeze([
  // The keystore. Each answers JSON: {"value": string | null} or {"error": "…"}.
  'secureGet', 'secureSet', 'secureDelete',
  // HTTP on the native stack. Answers through window.__tgHeadlessHttpDone.
  'httpRequestAsync',
  // What the home screen shows and what Android should remind about.
  'updateSnapshot',
  // Writes made on the home screen while nothing was running.
  'pendingWrites', 'acknowledgeWrites',
  // The run's own protocol with the worker.
  'shouldAbort', 'done',
] as const)

export interface HeadlessBridge {
  secureGet(key: string): string
  secureSet(key: string, value: string): string
  secureDelete(key: string): string
  httpRequestAsync(callId: string, method: string, url: string, headersJson: string, body: string | null): void
  updateSnapshot(json: string): void
  pendingWrites(): string
  acknowledgeWrites(idsJson: string): void
  shouldAbort(): boolean
  done(json: string): void
}

declare global {
  interface Window {
    ThingGlanceHeadless?: HeadlessBridge
  }
}

// True when this page was loaded to run a refresh, not to be the app.
export function isHeadlessRequest(search: string | null | undefined): boolean {
  return new URLSearchParams(search ?? '').get(HEADLESS_PARAM) === HEADLESS_REFRESH
}

// The shell's bridge inside a headless run. Null in the app, and in a browser
// that opened the query by hand: with no bridge nothing headless happens.
export function headlessBridge(): HeadlessBridge | null {
  if (typeof window === 'undefined' || !isHeadlessRequest(window.location?.search)) return null
  return window.ThingGlanceHeadless ?? null
}

// The keystore answers JSON so that "nothing stored" and "could not read" are
// told apart, as src/sync/secrets.ts needs them to be.
function answer(json: string): string | null {
  const parsed = JSON.parse(json) as { value?: string | null; error?: string }
  if (parsed.error) throw new Error(parsed.error)
  return parsed.value ?? null
}

export function headlessSecureStore(bridge: HeadlessBridge): SecureStore {
  return {
    get: async (key) => answer(bridge.secureGet(key)),
    set: async (key, value) => { answer(bridge.secureSet(key, value)) },
    remove: async (key) => { answer(bridge.secureDelete(key)) },
  }
}

// The run as a shell: its requests on the native stack, its credentials from
// the keystore. No event stream: a run is over in seconds.
export function headlessShell(bridge: HeadlessBridge): ShellBridge {
  return { fetch: headlessFetch(bridge), secureStore: headlessSecureStore(bridge) }
}

export const HEADLESS_OUTCOMES = Object.freeze({
  RAN: 'ran',
  FAILED: 'failed',
  // The app was opened during the run: it takes over.
  ABORTED: 'aborted',
} as const)
export type HeadlessOutcome = (typeof HEADLESS_OUTCOMES)[keyof typeof HEADLESS_OUTCOMES]
