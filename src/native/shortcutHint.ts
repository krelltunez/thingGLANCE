// How the search shortcut is written beside the search field: with the
// Command key on Apple's platforms, with Ctrl everywhere else. The shortcut
// itself answers to both (App.tsx); this is only what the hint says.
//
// Read from the user agent, like the iPhone's zoom lock, so it is right in a
// browser tab as well as in the shells. An iPad counts either way it names
// itself (one asking for the desktop site says "Macintosh"): a keyboard
// attached to one has a Command key.
export function hasCommandKey(userAgent: string): boolean {
  return /Macintosh|iPad|iPhone|iPod/.test(userAgent)
}

// A key's name, the same in every language.
export function searchShortcutHint(userAgent: string): string {
  return hasCommandKey(userAgent) ? '⌘K' : 'Ctrl K'
}
