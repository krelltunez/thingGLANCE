// What is open: the view, the detail drawer, and at most one modal. A plain
// context so any component can open a form without prop-drilling.

import { createContext, useContext } from 'react'
import type { CategoryId } from '@/core/types'

export type View = 'glance' | 'horizon' | 'things' | 'plans'
export type SettingsSection = 'general' | 'vault' | 'household' | 'integrations' | 'data' | 'about'

export type Modal =
  | { type: 'thing'; id?: string; category?: CategoryId }
  | { type: 'subscription'; id?: string; thingId?: string }
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
