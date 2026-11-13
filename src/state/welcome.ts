// Whether the first-run welcome has been seen on this device.

const WELCOMED_KEY = 'tg_welcomed'

export const needsWelcome = (): boolean => localStorage.getItem(WELCOMED_KEY) !== '1'
export const markWelcomed = (): void => localStorage.setItem(WELCOMED_KEY, '1')
