// The desktop app's private-address permission, as the vault form sees it
// (docs/desktop.md, "Servers on your own network"). The main process refuses a
// server on a private network until the user grants its exact origin, and a
// refused request never reaches the server. So a connection test asks first,
// and says "needs your permission" with an Allow button, rather than reporting
// a network error for a server it never contacted.
//
// Off the desktop there is no such rule (a phone and the web reach a LAN
// server directly) and every helper here is a no-op. After lastGLANCE's
// src/sync/privateAddress.ts.

import { tr } from '@/core/text'
import { desktopBridge, type DesktopHttp } from '@/native/desktop'

export interface PrivateAddressBlock {
  origin: string
  // False for addresses no grant can unlock (link-local, reserved ranges).
  canGrant: boolean
}

type Http = Pick<DesktopHttp, 'inspect' | 'grant'>

const defaultHttp = (): Http | null => desktopBridge()?.http ?? null

// Whether the desktop will refuse `url`, before anything is sent. Null when it
// will go through, off the desktop, or when the check itself fails: it is a
// diagnostic, never a gate, and the real request reports whatever happens next.
export async function checkPrivateAddress(url: string | null | undefined, http: Http | null = defaultHttp()): Promise<PrivateAddressBlock | null> {
  if (!http || !url) return null
  try {
    const verdict = await http.inspect(url)
    return verdict.blocked ? { origin: verdict.origin, canGrant: verdict.canGrant } : null
  } catch {
    return null
  }
}

export const blockedMessage = (block: PrivateAddressBlock): string =>
  block.canGrant ? tr('settings.vault.private.needsPermission', { origin: block.origin }) : tr('settings.vault.private.refused', { origin: block.origin })

// The permission dialog's text. The main process has no catalog, so the
// translated words travel with the request; the origin and the addresses it
// resolves to are added by the main process, where no label can hide them.
export function consentLabels(): Record<string, string> {
  return {
    title: tr('settings.vault.private.consentTitle'),
    question: tr('settings.vault.private.consentQuestion'),
    resolvesTo: tr('settings.vault.private.consentResolvesTo'),
    warning: tr('settings.vault.private.consentWarning'),
    warningLoopback: tr('settings.vault.private.consentWarningLoopback'),
    scope: tr('settings.vault.private.consentScope'),
    allow: tr('settings.vault.private.consentAllow'),
    cancel: tr('common.cancel'),
  }
}

// Show the permission dialog for `url`. Null once the origin is granted, else
// the message to show (the user declined, or the address cannot be granted).
export async function grantPrivateAddress(url: string, http: Http | null = defaultHttp()): Promise<string | null> {
  if (!http) return tr('settings.vault.private.grantFailed')
  try {
    const result = await http.grant(url, consentLabels())
    return result.ok ? null : result.reason || tr('settings.vault.private.grantFailed')
  } catch {
    return tr('settings.vault.private.grantFailed')
  }
}
