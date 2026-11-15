import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSnapshot } from '@/core/snapshot'
import { setTranslator } from '@/core/text'
import type { DataSet, Subscription } from '@/core/types'
import { collectWidgetWrites, fingerprint, launcherBlock, widgetLabels, widgetShare, type NativeSurface, type WidgetPayload } from './widgetBridge'

afterEach(() => setTranslator(null))

describe('the words handed to the home screen', () => {
  it('writes the tile\'s line out for every number that can be waiting', () => {
    expect(widgetLabels(3).waiting).toEqual(['Nothing waiting', '1 waiting', '2 waiting', '3 waiting'])
    // With nothing waiting there is still the one phrase.
    expect(widgetLabels().waiting).toEqual(['Nothing waiting'])
    expect(widgetLabels(-2).waiting).toEqual(['Nothing waiting'])
  })

  it('lets the catalog pick the plural form, not the native side', () => {
    setTranslator((key, params) => (key === 'widget.tile.waiting' ? (params?.count === 1 ? 'eins wartet' : `${params?.count} warten`) : key), 'de')
    expect(widgetLabels(2).waiting.slice(1)).toEqual(['eins wartet', '2 warten'])
  })

  it('stops at a sensible length for a very long queue', () => {
    const { waiting } = widgetLabels(5000)
    expect(waiting.length).toBe(61)
    expect(waiting[60]).toBe('60 waiting')
  })
})

describe('writes queued outside the app', () => {
  // Both of these are refused before anything is read or written, so no
  // database is needed to see what is reported back.
  const queued = [
    { action: 'no_such_action', clientId: 'a', payload: {} },
    { action: 'create_thing', clientId: 'b', payload: {} },
    { action: 'create_thing', payload: { name: 'No id' } },
  ]

  it('reports how each one went when it acknowledges them', async () => {
    const order: string[] = []
    const acknowledge = vi.fn(async () => { order.push('acknowledge') })
    const surface: NativeSurface = { updateSnapshot: async () => {}, pendingWrites: async () => JSON.stringify(queued), acknowledgeWrites: acknowledge }
    const changed = await collectWidgetWrites(async () => { order.push('snapshot') }, surface)
    expect(changed).toBe(0)
    // The home screen is brought up to date first, then the queue is cleared.
    expect(order).toEqual(['snapshot', 'acknowledge'])
    const [ids, results] = acknowledge.mock.calls[0] as unknown as [string[], Record<string, { success: boolean; code?: string }>]
    // A write with no id of its own is not taken at all.
    expect(ids).toEqual(['a', 'b'])
    expect(results.a).toMatchObject({ success: false, code: 'unknown_action' })
    expect(results.b).toMatchObject({ success: false, code: 'invalid' })
  })

  it('acknowledges nothing when nothing is queued', async () => {
    const acknowledge = vi.fn(async () => {})
    await collectWidgetWrites(async () => {}, { updateSnapshot: async () => {}, pendingWrites: async () => '[]', acknowledgeWrites: acknowledge })
    expect(acknowledge).not.toHaveBeenCalled()
  })
})

describe('GLANCElauncher\'s share of the payload', () => {
  const stamp = '2026-01-01T00:00:00.000Z'
  const plan = (i: number): Subscription => ({
    id: `s${i}`, kind: 'subscription', name: `Plan ${i}`, amount: 10 + i, cycle: 'yearly', anchorDate: `2026-12-${String(i + 1).padStart(2, '0')}`,
    autoRenew: true, status: 'active', review: true, coversThingIds: [], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp,
  })
  const data: DataSet = { things: [], coverages: [], subscriptions: Array.from({ length: 20 }, (_, i) => plan(i)), decisions: [] }
  const opts = { viewerId: null, ref: '2026-11-15', now: Date.parse('2026-11-15T16:00:00Z') }
  // Built inside each test: the language in use is part of a snapshot.
  const build = () => buildSnapshot(data, { ...opts, limit: 40 })

  it('gives the widgets exactly what a build with their own limit gives', () => {
    const full = build()
    expect(full.attention.length).toBeGreaterThan(12)
    expect(widgetShare(full)).toEqual(buildSnapshot(data, { ...opts, limit: 12 }))
  })

  it('gives the launcher the longer lists, and when the vault last answered', () => {
    const full = build()
    const block = launcherBlock(full, '2026-11-15T15:00:00.000Z')
    expect(block.attention).toEqual(full.attention)
    expect(block.upcoming).toEqual(full.upcoming)
    expect(block.charges).toEqual(full.charges.items)
    expect(block.syncedAt).toBe('2026-11-15T15:00:00.000Z')
    // No storage here, so no ledger: an empty list, not a failure.
    expect(block.handledWrites).toEqual([])
  })

  it('does not count a later sync or a later build as a change', () => {
    const full = build()
    const payload = (generatedAt: string, syncedAt: string | null): WidgetPayload => ({
      snapshot: { ...widgetShare(full), generatedAt }, labels: widgetLabels(1), canSend: false, launcher: launcherBlock(full, syncedAt),
    })
    const a = payload('2026-11-15T16:00:00.000Z', null)
    expect(fingerprint(payload('2026-11-15T17:00:00.000Z', '2026-11-15T16:59:00.000Z'))).toBe(fingerprint(a))
    // A write that landed is a change: the launcher is waiting to see it.
    const landed = { ...a, launcher: { ...a.launcher, handledWrites: [{ clientId: 'w1', action: 'decide', entityId: 'k' }] } }
    expect(fingerprint(landed)).not.toBe(fingerprint(a))
  })
})
