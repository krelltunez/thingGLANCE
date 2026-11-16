// iPhone WebKit zooms the whole page in when a form control whose font is
// under 16px takes focus. Inside the app that is a one-way trip: Capacitor's
// WebView has pinching turned off, so nothing can zoom back out and the screen
// stays cropped until the app is closed and opened again. A home-screen PWA
// behaves the same; only a Safari tab lets the user pinch back.
//
// Capping the viewport at scale 1 leaves WebKit nothing to zoom to. iPhone
// only: an iPad does not zoom on focus, and Android and desktop browsers must
// keep pinch-to-zoom, which this would take away.
//
// From lastGLANCE's src/utils/viewportZoom.ts. Keep a fix in step with it.

// An iPad does not match (one asking for the desktop site says "Macintosh"),
// and neither does anything that is not Apple's.
export function isFocusZoomPlatform(userAgent: string): boolean {
  return /iPhone|iPod/.test(userAgent)
}

// Adds the cap and keeps whatever else the meta says. A maximum-scale already
// in the markup wins.
export function withScaleLock(content: string): string {
  if (/(^|[;,\s])maximum-scale\s*=/.test(content)) return content
  const existing = content.trim().replace(/,$/, '')
  return existing === '' ? 'maximum-scale=1' : `${existing}, maximum-scale=1`
}

// Does nothing off an iPhone, or on a page with no viewport meta.
export function lockViewportScaleOnIPhone(): void {
  if (!isFocusZoomPlatform(navigator.userAgent)) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  meta.setAttribute('content', withScaleLock(meta.getAttribute('content') ?? ''))
}
