import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFocusZoomPlatform, lockViewportScaleOnIPhone, withScaleLock } from './viewportZoom'

const IPHONE_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPAD_SAFARI = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD_DESKTOP_SITE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36'
const SHIPPED = 'width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content'

function stubPage(userAgent: string, content: string | null) {
  const meta = content === null ? null : {
    attrs: { content } as Record<string, string>,
    getAttribute(name: string) { return this.attrs[name] ?? null },
    setAttribute(name: string, value: string) { this.attrs[name] = value },
  }
  vi.stubGlobal('navigator', { userAgent })
  vi.stubGlobal('document', { querySelector: () => meta })
  return meta
}

describe('the iPhone zoom lock', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('is for the iPhone only', () => {
    expect(isFocusZoomPlatform(IPHONE_WEBVIEW)).toBe(true)
    expect(isFocusZoomPlatform(IPAD_SAFARI)).toBe(false)
    expect(isFocusZoomPlatform(IPAD_DESKTOP_SITE)).toBe(false)
    expect(isFocusZoomPlatform(ANDROID_CHROME)).toBe(false)
  })

  it('caps the scale and keeps the rest of the viewport', () => {
    expect(withScaleLock(SHIPPED)).toBe(`${SHIPPED}, maximum-scale=1`)
    expect(withScaleLock('')).toBe('maximum-scale=1')
    expect(withScaleLock('width=device-width,')).toBe('width=device-width, maximum-scale=1')
  })

  it('leaves a maximum-scale already in the markup', () => {
    expect(withScaleLock('width=device-width, maximum-scale=2')).toBe('width=device-width, maximum-scale=2')
  })

  it('changes the page on an iPhone', () => {
    const meta = stubPage(IPHONE_WEBVIEW, SHIPPED)
    lockViewportScaleOnIPhone()
    expect(meta?.attrs.content).toBe(`${SHIPPED}, maximum-scale=1`)
  })

  it('leaves Android able to pinch', () => {
    const meta = stubPage(ANDROID_CHROME, SHIPPED)
    lockViewportScaleOnIPhone()
    expect(meta?.attrs.content).toBe(SHIPPED)
  })

  it('does nothing on a page with no viewport meta', () => {
    stubPage(IPHONE_WEBVIEW, null)
    expect(() => lockViewportScaleOnIPhone()).not.toThrow()
  })
})
