// The shape of the app's live data and the hook that reads it. The provider
// that fills it is src/state/DataProvider.tsx.

import { createContext, useContext } from 'react'
import type { Coverage, DataSet, DeviceLink, HorizonEvent, Member, Subscription, Thing } from '@/core/types'
import type { Lifecycle } from '@/core/health'

// `things`, `coverages` and `subscriptions` here are already what this device
// may see: another member's private items are not in them (core/household).
export interface DataValue extends DataSet {
  ready: boolean
  // The household roster: everyone things are tracked for.
  members: Member[]
  // Which devices have said "this is me", and so which members are users.
  devices: DeviceLink[]
  userIds: Set<string>
  deviceId: string
  // More than one member on the roster: there is someone to tell apart, so
  // owners, payers and the member filter show.
  multiUser: boolean
  // The member this device belongs to, if it has said so.
  meId: string | null
  // The member the views are filtered to, or null for everyone.
  focusId: string | null
  // Everything below respects the member filter.
  visibleThings: Thing[]
  activeThings: Thing[]
  retiredThings: Thing[]
  visibleSubs: Subscription[]
  events: HorizonEvent[]
  queue: HorizonEvent[]
  life: Map<string, Lifecycle>
  thingById: Map<string, Thing>
  subById: Map<string, Subscription>
  coveragesFor: (thingId: string) => Coverage[]
  subsFor: (thingId: string) => Subscription[]
  // The member who deals with this date (whoever was picked, else the owner
  // or payer if they use the app), or null when it falls to nobody.
  handlerOf: (e: HorizonEvent) => string | null
  // True when the household has two or more users and this date falls to
  // nobody, so everyone is being asked about it.
  needsSomeone: (e: HorizonEvent) => boolean
  // Null for the household, and for a member who is no longer on the roster.
  memberName: (id: string | null | undefined) => string | null
}

export const DataContext = createContext<DataValue | null>(null)

export function useData(): DataValue {
  const v = useContext(DataContext)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
