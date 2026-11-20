import { describe, expect, it } from 'vitest'
import { hasCommandKey, searchShortcutHint } from './shortcutHint'

const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const MAC_APP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) thingGLANCE/1.0.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36'
const IPAD_APP = 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const IPHONE_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ANDROID_DESKTOP_SITE = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const WINDOWS_APP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) thingGLANCE/1.0.0 Chrome/140.0.0.0 Electron/38.0.0 Safari/537.36'
const CHROMEBOOK = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

describe('the search shortcut hint', () => {
  it('names the Command key on a Mac, an iPad and an iPhone', () => {
    for (const ua of [MAC_SAFARI, MAC_APP, IPAD_APP, IPHONE_APP]) {
      expect(hasCommandKey(ua)).toBe(true)
      expect(searchShortcutHint(ua)).toBe('⌘K')
    }
  })

  it('names Ctrl everywhere else', () => {
    for (const ua of [ANDROID_TABLET, ANDROID_DESKTOP_SITE, WINDOWS_APP, CHROMEBOOK, '']) {
      expect(hasCommandKey(ua)).toBe(false)
      expect(searchShortcutHint(ua)).toBe('Ctrl K')
    }
  })
})
