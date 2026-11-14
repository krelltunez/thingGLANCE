// Acts on links (core/links.ts): the address the app was opened with, and any
// link handed to openLink() afterwards. The only place a link turns into
// something on screen.

import { useEffect, useRef, useState } from 'react'
import { eventTarget, parseLink, type LinkTarget } from '@/core/links'
import { tr } from '@/core/text'
import { OPEN_LINK_EVENT, peekWaitingLink, takeWaitingLink } from '@/native/links'
import type { DataValue } from './data'
import { toast } from './toast'
import type { UI } from './ui'

// What the app was opened with: a link that arrived before anything was
// listening, else the address itself. Read without side effects (React may run
// a state initializer twice); the mount effect below does the clearing.
function openedWith(): LinkTarget | null {
  if (typeof window === 'undefined') return null
  return parseLink(peekWaitingLink()) ?? (window.location.search ? parseLink(window.location.href) : null)
}

const LOOK_AGAIN_MS = 700

export function useLinks(ui: UI, d: DataValue): void {
  const [pending, setPending] = useState<LinkTarget | null>(openedWith)
  // A link that names something not here yet is looked for once more: the
  // write that made it may have landed a moment before the screen caught up.
  const lookedAgain = useRef(false)

  useEffect(() => {
    // Taken. Clear the address bar too, so a reload or a shared screenshot
    // does not repeat the link.
    takeWaitingLink()
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname)
    const onLink = (e: Event) => {
      const target = parseLink((e as CustomEvent<string>).detail)
      takeWaitingLink()
      if (target) setPending(target)
    }
    window.addEventListener(OPEN_LINK_EVENT, onLink)
    return () => window.removeEventListener(OPEN_LINK_EVENT, onLink)
  }, [])

  const { ready } = d
  useEffect(() => {
    // Things, plans and dates have to be looked up, so those wait for the data.
    if (!pending || !ready) return
    setPending(null)
    const target = pending
    const gone = (what: 'thing' | 'plan' | 'date') => {
      if (!lookedAgain.current) {
        lookedAgain.current = true
        setTimeout(() => setPending(target), LOOK_AGAIN_MS)
        return
      }
      lookedAgain.current = false
      toast({ title: tr(`toast.gone.${what}`), body: tr('toast.goneBody') })
    }
    const found = () => { lookedAgain.current = false }
    switch (pending.kind) {
      case 'view': ui.close(); ui.openThing(null); ui.setView(pending.view); break
      case 'queue': ui.close(); ui.openThing(null); ui.setView('glance'); break
      case 'thing':
        if (d.thingById.has(pending.id)) { found(); ui.close(); ui.openThing(pending.id) } else gone('thing')
        break
      case 'plan':
        if (d.subById.has(pending.id)) { found(); ui.open({ type: 'subscription', id: pending.id }) } else gone('plan')
        break
      case 'event': {
        // A date leads to its plan if it is a plan's, else to its thing. One
        // that has dropped off the horizon still names what it belonged to.
        const to = eventTarget(pending.key, {
          hasThing: (id) => d.thingById.has(id),
          hasPlan: (id) => d.subById.has(id),
          coverageThing: (id) => d.coverages.find((c) => c.id === id)?.thingId,
        }, d.events.find((x) => x.key === pending.key))
        if (to?.kind === 'plan') { found(); ui.open({ type: 'subscription', id: to.id }) }
        else if (to) { found(); ui.close(); ui.openThing(to.id) }
        else gone('date')
        break
      }
      case 'add': ui.open(pending.what === 'thing' ? { type: 'thing', name: pending.name } : { type: 'subscription', name: pending.name }); break
      case 'settings': ui.open({ type: 'settings', section: pending.section }); break
      case 'search': ui.open({ type: 'palette', query: pending.q }); break
    }
    // Acting on a link once is the point; `ui` and `d` are read as they are now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ready])
}
