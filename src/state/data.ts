// The shape of the app's live data and the hook that reads it. The provider
// that fills it is src/state/DataProvider.tsx.

import { createContext, useContext } from 'react'
import type { Coverage, DataSet, HorizonEvent, Subscription, Thing, User } from '@/core/types'
import type { Lifecycle } from '@/core/health'
import type { UserFilter } from '@/multiuser/settings'

export interface DataValue extends DataSet {
  ready: boolean
  users: User[]
  multiUser: boolean
  meId: string | null
  filter: UserFilter
  // Everything below respects the Mine / Everyone filter.
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
  userName: (id: string | null | undefined) => string | null
}

export const DataContext = createContext<DataValue | null>(null)

export function useData(): DataValue {
  const v = useContext(DataContext)
  if (!v) throw new Error('useData outside DataProvider')
  return v
}
