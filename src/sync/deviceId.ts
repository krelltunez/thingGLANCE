// Stable per-device identifier for the vault transport. Generated once,
// persisted for the life of the installation, never synced.
//
// The page's storage is where it is read from, because it is read
// synchronously in many places. On a shell whose keystore stays on the device
// while that storage can arrive from another one, the keystore is what decides
// which id this device has (deviceIdentity.ts), and this is its copy.

export const DEVICE_ID_KEY = 'thingglance-device-id'

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

// The id in the page's storage, without making one.
export function storedDeviceId(): string | null {
  try { return localStorage.getItem(DEVICE_ID_KEY) || null } catch { return null }
}

// Only deviceIdentity.ts calls this, at boot, before anything has read the id.
export function setDeviceId(id: string): void {
  localStorage.setItem(DEVICE_ID_KEY, id)
}
