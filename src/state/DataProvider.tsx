// One live read of the whole dataset, plus everything derived from it, shared
// by every view through context. Dexie's liveQuery re-runs on any write to
// these tables, local or pulled from the vault, so nothing needs a manual
// refresh.

import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/client'
import type { Coverage, DataSet, Subscription, Thing, User } from '@/core/types'
import { attentionQueue, buildHorizon } from '@/core/horizon'
import { lifecycle, type Lifecycle } from '@/core/health'
import { DataContext, type DataValue } from './data'
import { getMeUserId, getMultiUserEnabled, getUserFilter, multiUserSnapshot, subscribeMultiUser, type UserFilter } from '@/multiuser/settings'

const EMPTY: DataSet & { users: User[] } = { things: [], coverages: [], subscriptions: [], decisions: [], users: [] }

export function DataProvider({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(async () => {
    const [things, coverages, subscriptions, decisions, users] = await Promise.all([
      db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.users.toArray(),
    ])
    return { things, coverages, subscriptions, decisions, users }
  }, [])
  const mu = useSyncExternalStore(subscribeMultiUser, multiUserSnapshot)

  const value = useMemo<DataValue>(() => {
    const d = raw ?? EMPTY
    const multiUser = getMultiUserEnabled()
    const meId = multiUser ? getMeUserId() : null
    const filter: UserFilter = multiUser && meId ? getUserFilter() : 'all'
    const userId = filter === 'mine' ? meId : null

    const thingById = new Map(d.things.map((t) => [t.id, t]))
    const subById = new Map(d.subscriptions.map((s) => [s.id, s]))
    const mine = (t: Thing) => !userId || t.ownerIds.length === 0 || t.ownerIds.includes(userId)
    const visibleThings = d.things.filter(mine).sort((a, b) => a.name.localeCompare(b.name))
    const visibleSubs = d.subscriptions.filter((s) => {
      if (!userId) return true
      if (s.payerId) return s.payerId === userId
      const t = s.thingId ? thingById.get(s.thingId) : undefined
      return !t || mine(t)
    })

    const byThing = new Map<string, Coverage[]>()
    for (const c of d.coverages) {
      const list = byThing.get(c.thingId) ?? []
      list.push(c)
      byThing.set(c.thingId, list)
    }
    for (const list of byThing.values()) list.sort((a, b) => (a.endDate < b.endDate ? -1 : 1))
    const subsByThing = new Map<string, Subscription[]>()
    for (const s of d.subscriptions) {
      if (!s.thingId) continue
      const list = subsByThing.get(s.thingId) ?? []
      list.push(s)
      subsByThing.set(s.thingId, list)
    }

    const life = new Map<string, Lifecycle>()
    for (const t of d.things) life.set(t.id, lifecycle(t, byThing.get(t.id) ?? []))

    const events = buildHorizon(d, { userId })
    const names = new Map(d.users.map((u) => [u.id, u.name]))

    return {
      ...d,
      ready: raw !== undefined,
      users: [...d.users].sort((a, b) => a.name.localeCompare(b.name)),
      multiUser,
      meId,
      filter,
      visibleThings,
      activeThings: visibleThings.filter((t) => t.status === 'active'),
      retiredThings: visibleThings.filter((t) => t.status === 'retired'),
      visibleSubs,
      events,
      queue: attentionQueue(events),
      life,
      thingById,
      subById,
      coveragesFor: (id) => byThing.get(id) ?? [],
      subsFor: (id) => subsByThing.get(id) ?? [],
      userName: (id) => (id ? names.get(id) ?? null : null),
    }
    // `mu` is the multi-user snapshot string: it changing is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, mu])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
