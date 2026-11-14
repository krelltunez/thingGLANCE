import type { CategoryId } from './types'
import { tr } from './text'

export interface Category {
  id: CategoryId
  // lucide-react icon name; resolved in src/components/icons.tsx so core stays
  // free of React.
  icon: string
  // How long people typically keep one, in months. The default "replace by".
  lifespanMonths: number
}

export const CATEGORIES: Category[] = [
  { id: 'phone', icon: 'Smartphone', lifespanMonths: 48 },
  { id: 'laptop', icon: 'Laptop', lifespanMonths: 60 },
  { id: 'desktop', icon: 'PcCase', lifespanMonths: 72 },
  { id: 'tablet', icon: 'Tablet', lifespanMonths: 60 },
  { id: 'watch', icon: 'Watch', lifespanMonths: 48 },
  { id: 'audio', icon: 'Headphones', lifespanMonths: 48 },
  { id: 'tv', icon: 'Tv', lifespanMonths: 84 },
  { id: 'display', icon: 'Monitor', lifespanMonths: 84 },
  { id: 'console', icon: 'Gamepad2', lifespanMonths: 72 },
  { id: 'camera', icon: 'Camera', lifespanMonths: 72 },
  // Doorbells and cameras that watch the house. Apart from `camera` (the kind
  // you take pictures with) and from `smarthome` (bulbs, plugs, thermostats).
  { id: 'security', icon: 'Cctv', lifespanMonths: 72 },
  { id: 'network', icon: 'Router', lifespanMonths: 60 },
  { id: 'storage', icon: 'HardDrive', lifespanMonths: 72 },
  { id: 'smarthome', icon: 'Lightbulb', lifespanMonths: 60 },
  { id: 'printer', icon: 'Printer', lifespanMonths: 72 },
  { id: 'accessory', icon: 'Cable', lifespanMonths: 48 },
  { id: 'software', icon: 'AppWindow', lifespanMonths: 36 },
  { id: 'other', icon: 'Box', lifespanMonths: 60 },
]

const byId = new Map(CATEGORIES.map((c) => [c.id, c]))
export const category = (id: CategoryId | undefined): Category => byId.get(id ?? 'other') ?? byId.get('other')!

// Functions, not fields: the words follow the language in use when asked.
export const categoryLabel = (id: CategoryId | undefined): string => tr(`category.${category(id).id}.label`)
export const categoryPlural = (id: CategoryId | undefined): string => tr(`category.${category(id).id}.plural`)

// Guess a category from free text (a product name or a Wikipedia description).
export function guessCategory(text: string): CategoryId | null {
  const t = text.toLowerCase()
  const rules: [RegExp, CategoryId][] = [
    [/\b(iphone|pixel \d|galaxy s|galaxy z|smartphone|phone)\b/, 'phone'],
    [/\b(ipad|tablet|galaxy tab|kindle|e-reader)\b/, 'tablet'],
    [/\b(macbook|laptop|notebook|thinkpad|chromebook|surface laptop|xps)\b/, 'laptop'],
    [/\b(imac|mac mini|mac studio|mac pro|desktop|workstation|nuc)\b/, 'desktop'],
    [/\b(watch|fitbit|garmin|wearable)\b/, 'watch'],
    [/\b(airpods|headphones|earbuds|speaker|homepod|sonos|soundbar)\b/, 'audio'],
    [/\b(playstation|xbox|nintendo|switch|steam deck|console)\b/, 'console'],
    [/\b(television|oled|qled|\btv\b|apple tv|chromecast|roku)\b/, 'tv'],
    [/\b(monitor|display)\b/, 'display'],
    // Before `camera` and `smarthome`, which would otherwise claim these.
    [/\b(doorbell|security camera|cctv|floodlight cam|nest cam|arlo|blink|wyze cam|eufycam)\b/, 'security'],
    [/\b(camera|mirrorless|dslr|gopro)\b/, 'camera'],
    [/\b(router|wi-?fi|mesh|switch|access point|unifi|eero)\b/, 'network'],
    [/\b(nas|synology|ssd|hard drive|storage)\b/, 'storage'],
    [/\b(printer|scanner)\b/, 'printer'],
    [/\b(thermostat|smart lock|hue|nest|ring|smart home)\b/, 'smarthome'],
  ]
  for (const [re, id] of rules) if (re.test(t)) return id
  return null
}
