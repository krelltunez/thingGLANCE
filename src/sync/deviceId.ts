// Stable per-device identifier for the vault transport. Generated once,
// persisted for the life of the installation, never synced.

const DEVICE_ID_KEY = 'thingglance-device-id'

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}
