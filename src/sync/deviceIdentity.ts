// Which device this is, when the page's storage can arrive from another one.
//
// An iPhone set up from a backup gets the app's whole container: the
// database, the sync cursors and the device id (docs/ios.md, "Backups"). The
// Keychain items stay behind, because they are kept for this device only. Left
// alone, the new phone would call itself by the old phone's id. The vault takes
// a second enrolment under one id as replacing the first and revokes its
// credential, and it keeps one cursor per id: an iPad set up from the iPhone's
// backup, or an old phone kept in use, would sign each other out and report
// each other's progress.
//
// So on such a shell (ShellBridge.deviceBoundKeystore) the keystore says which
// id this device has, and the page's storage holds a copy for the many places
// that read it synchronously. At boot, before anything reads the id:
//
//   keystore   page      what it means                  what happens
//   same id    same id   this device, as before         nothing
//   an id      none      the page's storage was lost    the copy is put back
//   none       none      a new install                  a new id, kept in both
//   none       an id     the storage came from another  a new id; see below.
//                        device                         (A build from before
//                                                       this check that is
//                                                       connected keeps its id)
//   an id      another   the same, onto a device that   the keystore's id; see
//                        already had one                below
//   no answer  any       not known this launch          nothing; asked again
//                                                       at the next start
//
// A copy that came from another device is a device that was never connected:
// whatever is left of the connection is removed (disconnectVault), the person
// the old device belonged to is carried over to the new id, and if the copy was
// syncing where it came from a note says that it is not syncing here
// (restoredCopy.ts). The data stays. The old device's own row is left alone: it
// is that device's to write, and it may still be in use.
//
// The steps are ordered so that a launch cut short at any point is finished by
// the next one: the keystore commits at once and the page's storage does not.

import { inheritDeviceLink } from '@/db/queries'
import { forgetNotifyAsked } from '@/native/notifications'
import { secureStore, shellBridge } from '@/native/shell'
import { getDeviceId, setDeviceId, storedDeviceId } from './deviceId'
import { setRestoredCopyNotice } from './restoredCopy'
import { VAULT_CONFIG_KEY, secureOp } from './secrets'
import { hadVaultStream } from './vaultConfig'
import { disconnectVault } from './vaultConnect'

// The keystore's entry. Like every other, it does not leave the device.
export const DEVICE_ENTRY = 'device.id'
// The id the page's storage arrived with, until its member has been carried over.
const CAME_FROM_KEY = 'tg_device_came_from'

export type DeviceIdentity =
  | 'not-bound' // this shell's keystore travels with the storage, or there is none
  | 'same'
  | 'put-back'
  | 'new'
  | 'kept' // a connected build from before this check
  | 'restored'
  | 'unknown' // the keystore did not answer

const keep = (id: string): Promise<void> => secureOp((store) => store.set(DEVICE_ENTRY, id))

async function settle(): Promise<DeviceIdentity> {
  const kept = (await secureOp((store) => store.get(DEVICE_ENTRY))) || null
  const local = storedDeviceId()
  if (kept && kept === local) return 'same'
  if (kept && !local) { setDeviceId(kept); return 'put-back' }
  if (!kept && !local) {
    const id = crypto.randomUUID()
    await keep(id)
    setDeviceId(id)
    return 'new'
  }
  // Before this check existed, a device had an id and no entry. One that still
  // holds its connection is plainly the device that made it.
  if (!kept && (await secureOp((store) => store.get(VAULT_CONFIG_KEY))) !== null) {
    await keep(local!)
    return 'kept'
  }

  // The storage came from another device. The note first: it is read from the
  // same storage the disconnect is about to clear, and must not be lost to a
  // launch that ends between the two.
  if (hadVaultStream()) setRestoredCopyNotice()
  await disconnectVault()
  const id = kept ?? crypto.randomUUID()
  if (!kept) await keep(id)
  try { if (!localStorage.getItem(CAME_FROM_KEY)) localStorage.setItem(CAME_FROM_KEY, local!) } catch { /* the member is chosen again in Settings */ }
  setDeviceId(id)
  // Permission to notify was the other device's. This one asks for itself.
  forgetNotifyAsked()
  return 'restored'
}

// Whoever held the device the storage came from holds this one. Kept apart
// from the id change so that a launch cut short between the two still does it.
async function carryMember(): Promise<void> {
  let from: string | null = null
  try { from = localStorage.getItem(CAME_FROM_KEY) } catch { return }
  if (!from) return
  await inheritDeviceLink(from)
  try { localStorage.removeItem(CAME_FROM_KEY) } catch { /* asked again next start, and finds it done */ }
}

let settled: Promise<DeviceIdentity> | null = null

// Run once at boot, before hydrateSecrets() (what it removes must not be
// picked up again) and before anything that reads the device id: asked a
// second time, it answers with the first run. It never rejects.
export function settleDeviceIdentity(): Promise<DeviceIdentity> {
  settled ??= run()
  return settled
}

// For tests: the page going away and coming back.
export function resetDeviceIdentityForTests(): void {
  settled = null
}

async function run(): Promise<DeviceIdentity> {
  if (!secureStore() || !shellBridge()?.deviceBoundKeystore) return 'not-bound'
  let outcome: DeviceIdentity = 'unknown'
  try {
    outcome = await settle()
  } catch (err) {
    console.warn('[thingglance] the device id could not be checked against the secure store:', err instanceof Error ? err.message : err)
  }
  try {
    await carryMember()
  } catch (err) {
    console.warn('[thingglance] the member of the device this copy came from was not carried over:', err instanceof Error ? err.message : err)
  }
  if (outcome === 'restored') console.info('[thingglance] this copy came from another device: new device id', getDeviceId())
  return outcome
}
