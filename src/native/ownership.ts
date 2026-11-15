// "Owned since": asks the shell whether this copy of the app was bought, and
// keeps the answer where it will reach the vault.
//
// Only a store build knows. On Android the native side answers when the Play
// Store installed the app (android: ownership/); a sideloaded or debug build,
// the web app and the PWA have nothing to report, and nothing is recorded for
// them. Nothing here, or anywhere else, checks the record: it is kept so that
// people who paid can be recognised later if the price model ever changes
// (docs/release.md, "Owned since").

import { registerPlugin } from '@capacitor/core'
import { recordOwnership } from '@/db/queries'

interface OwnershipPlugin {
  // { since: epoch milliseconds, store, version }, or {} when not bought.
  get(): Promise<{ since?: number; store?: string; version?: string }>
}

const OwnershipBridge = registerPlugin<OwnershipPlugin>('Ownership')

export async function recordOwnershipFromShell(): Promise<void> {
  try {
    const fact = await OwnershipBridge.get()
    if (typeof fact.since !== 'number' || fact.since <= 0 || !fact.store) return
    await recordOwnership({ since: new Date(fact.since).toISOString(), store: fact.store, version: fact.version || __APP_VERSION__ })
  } catch {
    // A shell without the plugin, or storage that is not ready: asked again on the next start.
  }
}
