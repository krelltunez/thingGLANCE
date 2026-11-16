import { describe, expect, it } from 'vitest'
import type { SnapshotThing } from '@/core/snapshot'
import { searchThings } from './search'

const thing = (name: string, category: string, daysLeft: number | null): SnapshotThing => ({
  id: name, name, category, verdict: 'solid', remaining: null, lifeEnd: null, daysLeft, lifeStart: null, coverageEnd: null, supportEnd: null, lifeEndReason: null, ownerMemberId: null,
})
const THINGS = [thing('MacBook Pro', 'laptop', 400), thing('Café grinder', 'appliance', 30), thing('Pixel 9', 'phone', null), thing('Pro Display', 'monitor', 90)]
const label = (id: string) => ({ laptop: 'Laptop', appliance: 'Appliance', phone: 'Phone', monitor: 'Monitor' })[id] ?? id

describe('searching things from the tray', () => {
  it('finds by name, ignoring case and accents', () => {
    expect(searchThings(THINGS, 'cafe', label).map((t) => t.name)).toEqual(['Café grinder'])
    expect(searchThings(THINGS, 'PIXEL', label).map((t) => t.name)).toEqual(['Pixel 9'])
  })

  it('wants every word, in the name or the category', () => {
    expect(searchThings(THINGS, 'pro laptop', label).map((t) => t.name)).toEqual(['MacBook Pro'])
    expect(searchThings(THINGS, 'pro phone', label)).toEqual([])
  })

  it('puts what is closest to the end of its window first, and things with no dates last', () => {
    expect(searchThings(THINGS, 'p', label).map((t) => t.name)).toEqual(['Café grinder', 'Pro Display', 'MacBook Pro', 'Pixel 9'])
  })

  it('answers nothing for an empty search', () => {
    expect(searchThings(THINGS, '   ', label)).toEqual([])
  })
})
