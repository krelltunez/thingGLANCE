// The tray popup's search: every word typed has to appear in a thing's name or
// its category, ignoring case and accents. Things closest to needing attention
// come first, as the Things page orders them. After lastGLANCE's
// src/tray/search.ts.

import type { SnapshotThing } from '@/core/snapshot'

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// `categoryName` turns a category's id into the word shown for it.
export function searchThings(things: SnapshotThing[], query: string, categoryName: (id: string) => string, limit = 20): SnapshotThing[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const rank = (t: SnapshotThing): number => (t.daysLeft === null ? Number.POSITIVE_INFINITY : t.daysLeft)
  return things
    .filter((t) => { const hay = `${fold(t.name)} ${fold(categoryName(t.category))}`; return words.every((w) => hay.includes(w)) })
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, limit)
}
