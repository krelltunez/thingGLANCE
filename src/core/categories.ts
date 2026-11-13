import type { CategoryId } from './types'

export interface Category {
  id: CategoryId
  label: string
  plural: string
  // lucide-react icon name; resolved in src/components/icons.tsx so core stays
  // free of React.
  icon: string
  // How long people typically keep one, in months. The default "replace by".
  lifespanMonths: number
}

export const CATEGORIES: Category[] = [
  { id: 'phone', label: 'Phone', plural: 'Phones', icon: 'Smartphone', lifespanMonths: 48 },
  { id: 'laptop', label: 'Laptop', plural: 'Laptops', icon: 'Laptop', lifespanMonths: 60 },
  { id: 'desktop', label: 'Desktop', plural: 'Desktops', icon: 'PcCase', lifespanMonths: 72 },
  { id: 'tablet', label: 'Tablet', plural: 'Tablets', icon: 'Tablet', lifespanMonths: 60 },
  { id: 'watch', label: 'Watch', plural: 'Watches', icon: 'Watch', lifespanMonths: 48 },
  { id: 'audio', label: 'Audio', plural: 'Audio', icon: 'Headphones', lifespanMonths: 48 },
  { id: 'tv', label: 'TV', plural: 'TVs', icon: 'Tv', lifespanMonths: 84 },
  { id: 'display', label: 'Display', plural: 'Displays', icon: 'Monitor', lifespanMonths: 84 },
  { id: 'console', label: 'Console', plural: 'Consoles', icon: 'Gamepad2', lifespanMonths: 72 },
  { id: 'camera', label: 'Camera', plural: 'Cameras', icon: 'Camera', lifespanMonths: 72 },
  { id: 'network', label: 'Network', plural: 'Network', icon: 'Router', lifespanMonths: 60 },
  { id: 'storage', label: 'Storage', plural: 'Storage', icon: 'HardDrive', lifespanMonths: 72 },
  { id: 'smarthome', label: 'Smart home', plural: 'Smart home', icon: 'Lightbulb', lifespanMonths: 60 },
  { id: 'printer', label: 'Printer', plural: 'Printers', icon: 'Printer', lifespanMonths: 72 },
  { id: 'accessory', label: 'Accessory', plural: 'Accessories', icon: 'Cable', lifespanMonths: 48 },
  { id: 'software', label: 'Software', plural: 'Software', icon: 'AppWindow', lifespanMonths: 36 },
  { id: 'other', label: 'Other', plural: 'Other', icon: 'Box', lifespanMonths: 60 },
]

const byId = new Map(CATEGORIES.map((c) => [c.id, c]))
export const category = (id: CategoryId | undefined): Category => byId.get(id ?? 'other') ?? byId.get('other')!

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
    [/\b(camera|mirrorless|dslr|gopro)\b/, 'camera'],
    [/\b(router|wi-?fi|mesh|switch|access point|unifi|eero)\b/, 'network'],
    [/\b(nas|synology|ssd|hard drive|storage)\b/, 'storage'],
    [/\b(printer|scanner)\b/, 'printer'],
    [/\b(thermostat|doorbell|smart lock|hue|nest|ring|smart home)\b/, 'smarthome'],
  ]
  for (const [re, id] of rules) if (re.test(t)) return id
  return null
}
