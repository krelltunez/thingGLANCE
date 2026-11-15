import { afterEach, describe, expect, it } from 'vitest'
import { setTranslator } from '@/core/text'
import { widgetLabels } from './widgetBridge'

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
