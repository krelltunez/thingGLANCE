import { afterEach, describe, expect, it, vi } from 'vitest'
import { setTranslator } from '@/core/text'
import { collectWidgetWrites, widgetLabels, type NativeSurface } from './widgetBridge'

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
