// The built-in sample set. Every date is relative to today, so the samples
// always tell the same story: something expiring this month, something to
// replace this year, something already past its window.
//
// Sample rows are flagged `sample: true` and stay on this device: the vault
// engine never pushes them (src/sync/dbEngine.ts). Editing one makes it real.

import dayjs from 'dayjs'
import { db } from './client'
import type { Coverage, Subscription, Thing } from '@/core/types'
import { DAY } from '@/core/dates'

const monthsAgo = (m: number, dayOffset = 0) => dayjs().subtract(m, 'month').add(dayOffset, 'day').format(DAY)
const inDays = (d: number) => dayjs().add(d, 'day').format(DAY)
const inMonths = (m: number, dayOffset = 0) => dayjs().add(m, 'month').add(dayOffset, 'day').format(DAY)

let n = 0
const id = (p: string) => `sample-${p}-${(++n).toString().padStart(2, '0')}`

export function buildSamples(): { things: Thing[]; coverages: Coverage[]; subscriptions: Subscription[] } {
  n = 0
  const stamp = new Date().toISOString()
  const base = { createdAt: stamp, updatedAt: stamp, sample: true as const }
  const things: Thing[] = []
  const coverages: Coverage[] = []
  const subscriptions: Subscription[] = []

  const thing = (t: Omit<Thing, 'id' | 'kind' | 'status' | 'ownerIds' | 'createdAt' | 'updatedAt'> & Partial<Pick<Thing, 'status'>>): string => {
    const tid = id('thing')
    things.push({ status: 'active', ownerIds: [], ...t, id: tid, kind: 'thing', ...base })
    return tid
  }
  const cover = (thingId: string, c: Omit<Coverage, 'id' | 'kind' | 'thingId' | 'createdAt' | 'updatedAt'>) =>
    coverages.push({ ...c, id: id('cov'), kind: 'coverage', thingId, ...base })
  const sub = (s: Omit<Subscription, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'autoRenew' | 'status' | 'review'> & Partial<Pick<Subscription, 'autoRenew' | 'status' | 'review'>>) =>
    subscriptions.push({ autoRenew: true, status: 'active', review: false, ...s, id: id('sub'), kind: 'subscription', ...base })

  // Laptop: mid-life, extended coverage still running.
  const mbp = thing({
    name: 'MacBook Pro 14″', category: 'laptop', brand: 'Apple', model: 'M3 Pro, 18 GB, 1 TB',
    purchaseDate: monthsAgo(24, 3), price: 2399, retailer: 'Apple Store', releaseDate: monthsAgo(36),
    supportEnd: inMonths(60), supportBasis: 'estimate', lifespanMonths: 60, pinned: true,
    specs: [
      { label: 'Chip', value: 'Apple M3 Pro (11-core CPU, 14-core GPU)' },
      { label: 'Memory', value: '18 GB unified' },
      { label: 'Storage', value: '1 TB SSD' },
      { label: 'Display', value: '14.2″ Liquid Retina XDR, 120 Hz' },
    ],
    notes: 'Battery at 91% health last check.',
  })
  cover(mbp, { type: 'warranty', name: 'Limited warranty', provider: 'Apple', startDate: monthsAgo(24, 3), endDate: monthsAgo(12, 3) })
  cover(mbp, { type: 'extended', name: 'AppleCare+', provider: 'Apple', startDate: monthsAgo(24, 3), endDate: inMonths(12, 3), cost: 279 })

  // Phone: on a three-year plan, so it is coming up.
  const phone = thing({
    name: 'iPhone 15 Pro', category: 'phone', brand: 'Apple', model: '256 GB, Natural Titanium',
    purchaseDate: monthsAgo(26, -4), price: 1099, retailer: 'Apple Store', releaseDate: monthsAgo(38),
    supportEnd: inMonths(46), supportBasis: 'estimate', lifespanMonths: 36,
    specs: [
      { label: 'Chip', value: 'A17 Pro' },
      { label: 'Storage', value: '256 GB' },
      { label: 'Display', value: '6.1″ Super Retina XDR, ProMotion' },
      { label: 'Connector', value: 'USB-C (USB 3)' },
    ],
  })
  cover(phone, { type: 'warranty', name: 'Limited warranty', provider: 'Apple', startDate: monthsAgo(26, -4), endDate: monthsAgo(14, -4) })
  sub({ thingId: phone, name: 'AppleCare+ with Theft and Loss', provider: 'Apple', amount: 13.49, cycle: 'monthly', anchorDate: monthsAgo(26, -4), review: true })
  sub({ thingId: phone, name: 'Unlimited Plus plan', provider: 'Verizon', amount: 65, cycle: 'monthly', anchorDate: monthsAgo(30, 9) })

  // Tablet: inside six months of its plan.
  thing({
    name: 'iPad Air', category: 'tablet', brand: 'Apple', model: '5th generation, 64 GB',
    purchaseDate: monthsAgo(55, 12), price: 599, retailer: 'Costco', releaseDate: monthsAgo(56),
    supportEnd: inMonths(20), supportBasis: 'estimate', lifespanMonths: 60,
  })

  // Old phone handed down: out of support.
  thing({
    name: 'Pixel 6', category: 'phone', brand: 'Google', model: '128 GB, Stormy Black',
    purchaseDate: monthsAgo(60, 2), price: 599, retailer: 'Google Store', releaseDate: monthsAgo(61),
    supportEnd: inDays(-19), supportBasis: 'official', lifespanMonths: 72,
    notes: 'Handed down. Still gets used for two-factor codes.',
  })

  // Headphones: warranty runs out in days.
  const cans = thing({
    name: 'WH-1000XM5', category: 'audio', brand: 'Sony', model: 'Wireless noise cancelling',
    purchaseDate: monthsAgo(12, 12), price: 399, retailer: 'Best Buy', lifespanMonths: 48,
    notes: 'Right ear cup creaks. Get it looked at before the warranty ends.',
  })
  cover(cans, { type: 'warranty', name: 'Manufacturer warranty', provider: 'Sony', startDate: monthsAgo(12, 12), endDate: inDays(12) })

  // TV: long plan, long protection plan.
  const tv = thing({
    name: 'LG C3 OLED 65″', category: 'tv', brand: 'LG', model: 'OLED65C3PUA',
    purchaseDate: monthsAgo(30), price: 1799, retailer: 'Best Buy', lifespanMonths: 96,
    supportEnd: inMonths(30), supportBasis: 'estimate',
  })
  cover(tv, { type: 'warranty', name: 'Manufacturer warranty', provider: 'LG', startDate: monthsAgo(30), endDate: monthsAgo(18) })
  cover(tv, { type: 'extended', name: 'Geek Squad Protection (5 yr)', provider: 'Best Buy', startDate: monthsAgo(30), endDate: inMonths(30), cost: 349 })

  // NAS: annual backup plan about to renew.
  const nas = thing({
    name: 'Synology DS923+', category: 'storage', brand: 'Synology', model: '4-bay, 4 × 8 TB',
    purchaseDate: monthsAgo(20, 6), price: 1260, retailer: 'B&H', lifespanMonths: 84,
  })
  cover(nas, { type: 'warranty', name: '3-year warranty', provider: 'Synology', startDate: monthsAgo(20, 6), endDate: inMonths(16, 6) })
  sub({ thingId: nas, name: 'C2 Storage 1 TB', provider: 'Synology', amount: 69.99, cycle: 'yearly', anchorDate: inDays(23) })

  // Router: quietly ageing.
  thing({
    name: 'UniFi Dream Router', category: 'network', brand: 'Ubiquiti', model: 'UDR',
    purchaseDate: monthsAgo(41), price: 199, retailer: 'Ubiquiti Store', lifespanMonths: 60,
  })

  // Doorbell with a cloud plan hanging off it.
  const bell = thing({
    name: 'Video Doorbell Pro 2', category: 'smarthome', brand: 'Ring', model: 'Hardwired',
    purchaseDate: monthsAgo(15), price: 229, retailer: 'Amazon', lifespanMonths: 72,
  })
  cover(bell, { type: 'warranty', name: 'Limited warranty', provider: 'Ring', startDate: monthsAgo(15), endDate: monthsAgo(3) })
  sub({ thingId: bell, name: 'Ring Home Standard', provider: 'Ring', amount: 99.99, cycle: 'yearly', anchorDate: inMonths(3, 4) })

  // Retired, for the cost-of-ownership story.
  thing({
    name: 'MacBook Air', category: 'laptop', brand: 'Apple', model: 'M1, 8 GB, 256 GB',
    purchaseDate: monthsAgo(70), price: 999, retailer: 'Apple Store', status: 'retired',
    retiredAt: monthsAgo(24), resaleValue: 420,
  })

  // Plans that stand on their own.
  sub({ name: 'iCloud+ 2 TB', provider: 'Apple', amount: 9.99, cycle: 'monthly', anchorDate: monthsAgo(40, 17) })
  sub({ name: 'Microsoft 365 Family', provider: 'Microsoft', amount: 129.99, cycle: 'yearly', anchorDate: inMonths(5, 2) })
  sub({ name: '1Password Families', provider: '1Password', amount: 59.88, cycle: 'yearly', anchorDate: inDays(41) })
  sub({ name: 'YouTube Premium', provider: 'Google', amount: 13.99, cycle: 'monthly', anchorDate: monthsAgo(18, 5) })
  sub({ name: 'Lightroom (1 TB)', provider: 'Adobe', amount: 11.99, cycle: 'monthly', anchorDate: inDays(6), status: 'trial', trialEnd: inDays(6) })

  return { things, coverages, subscriptions }
}

export async function loadSamples(): Promise<void> {
  const s = buildSamples()
  await db.transaction('rw', db.things, db.coverages, db.subscriptions, async () => {
    await db.things.bulkPut(s.things)
    await db.coverages.bulkPut(s.coverages)
    await db.subscriptions.bulkPut(s.subscriptions)
  })
}
