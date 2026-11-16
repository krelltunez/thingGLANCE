// The Lucide icon each key draws, by the names lucide-react uses. The table of
// their markup is generated from this file (scripts/gen-assets.mjs reads the
// names out of it), so adding a name here is all it takes.
//
// The two maps repeat the app's own: a kind of date to its icon
// (src/components/icons.tsx, EVENT_ICONS) and a category of thing to its icon
// (src/core/categories.ts). keys.test.ts holds them equal.

export const EVENT_ICON: Record<string, string> = {
  'coverage-end': 'ShieldCheck',
  'support-end': 'LifeBuoy',
  replace: 'CircleArrowUp',
  renewal: 'Repeat',
  'trial-end': 'Hourglass',
  'sub-end': 'CalendarX',
}

export const CATEGORY_ICON: Record<string, string> = {
  phone: 'Smartphone', laptop: 'Laptop', desktop: 'PcCase', tablet: 'Tablet', watch: 'Watch', audio: 'Headphones',
  tv: 'Tv', display: 'Monitor', console: 'Gamepad2', camera: 'Camera', security: 'Cctv', network: 'Router',
  storage: 'HardDrive', smarthome: 'Lightbulb', printer: 'Printer', accessory: 'Cable', software: 'AppWindow', other: 'Box',
}

// The keys' own.
export const ICON_OFFLINE = 'PlugZap'
export const ICON_WAITING = 'Hourglass'
export const ICON_CLEAR = 'CircleCheck'
export const ICON_CALENDAR = 'CalendarClock'
export const ICON_ADD = 'Plus'
export const ICON_THING = 'Box'
