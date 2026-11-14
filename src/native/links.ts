// The one door a link comes in through. Whatever received it (a shell's
// "app opened with this URL" callback, a notification tap, the tray, the
// inbound intent handler) calls openLink(); the app's link hook
// (state/useLinks.ts) does the rest. Nothing else should act on a link itself.

export const OPEN_LINK_EVENT = 'tg:open-link'

// A link that arrived before the app was listening (a cold start from a
// notification): kept until the hook asks for it.
let waiting: string | null = null

export function openLink(link: string): void {
  waiting = link
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<string>(OPEN_LINK_EVENT, { detail: link }))
}

export const peekWaitingLink = (): string | null => waiting

export function takeWaitingLink(): string | null {
  const link = waiting
  waiting = null
  return link
}
