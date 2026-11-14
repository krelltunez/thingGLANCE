// What is open: the view, the detail drawer, and at most one modal. A plain
// context so any component can open a form without prop-drilling.

import { createContext, useContext } from 'react'
import type { LinkSettings, LinkView } from '@/core/links'
import type { CategoryId } from '@/core/types'

// The same names links use (core/links.ts), so a link can name any of them.
export type View = LinkView
export type SettingsSection = LinkSettings

export type Modal =
  // `name` prefills a new one (a link or a share can supply it).
  | { type: 'thing'; id?: string; category?: CategoryId; name?: string }
  | { type: 'subscription'; id?: string; thingId?: string; name?: string }
  | { type: 'coverage'; thingId: string; id?: string }
  | { type: 'settings'; section?: SettingsSection }
  | { type: 'passphrase' }
  | { type: 'palette' }
  | null

export interface UI {
  view: View
  setView: (v: View) => void
  thingId: string | null
  openThing: (id: string | null) => void
  modal: Modal
  open: (m: Modal) => void
  close: () => void
}

export const UIContext = createContext<UI | null>(null)

export function useUI(): UI {
  const v = useContext(UIContext)
  if (!v) throw new Error('useUI outside provider')
  return v
}
