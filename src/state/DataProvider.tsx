// One live read of the whole dataset, plus everything derived from it, shared
// by every view through context. Dexie's liveQuery re-runs on any write to
// these tables, local or pulled from the vault, so nothing needs a manual
// refresh.

import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/client'
import type { Coverage, DataSet, DeviceLink, Member, Subscription } from '@/core/types'
import { attentionQueue, buildHorizon } from '@/core/horizon'
import { lifecycle, type Lifecycle } from '@/core/health'
import { concernsPlan, concernsThing, memberOfDevice, userIds, visibleTo } from '@/core/household'
import { getDeviceId } from '@/sync/deviceId'
import { DataContext, type DataValue } from './data'
import { getMultiUserEnabled, getUserFilter, multiUserSnapshot, subscribeMultiUser, type UserFilter } from '@/multiuser/settings'

const EMPTY: DataSet & { members: Member[]; devices: DeviceLink[] } = { things: [], coverages: [], subscriptions: [], decisions: [], members: [], devices: [] }

export function DataProvider({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(async () => {
    const [things, coverages, subscriptions, decisions, members, devices] = await Promise.all([
      db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.members.toArray(), db.devices.toArray(),
    ])
    return { things, coverages, subscriptions, decisions, members, devices }
  }, [])
  const mu = useSyncExternalStore(subscribeMultiUser, multiUserSnapshot)

  const value = useMemo<DataValue>(() => {
    const all = raw ?? EMPTY
    const multiUser = getMultiUserEnabled()
    const deviceId = getDeviceId()
    const meId = multiUser ? memberOfDevice(all.devices, deviceId, all.members) : null
    const filter: UserFilter = multiUser && meId ? getUserFilter() : 'all'
    const focusId = filter === 'mine' ? meId : null

    // Privacy before anything else: nothing below ever sees another member's
    // private things or plans, so no view can show one by accident.
    const d = visibleTo(all, meId)

    const thingById = new Map(d.things.map((t) => [t.id, t]))
    const subById = new Map(d.subscriptions.map((s) => [s.id, s]))
    const visibleThings = d.things.filter((t) => !focusId || concernsThing(t, focusId)).sort((a, b) => a.name.localeCompare(b.name))
    const visibleSubs = d.subscriptions.filter((s) => !focusId || concernsPlan(s, focusId, thingById))

    const byThing = new Map<string, Coverage[]>()
    for (const c of d.coverages) {
      const list = byThing.get(c.thingId) ?? []
      list.push(c)
      byThing.set(c.thingId, list)
    }
    for (const list of byThing.values()) list.sort((a, b) => (a.endDate < b.endDate ? -1 : 1))
    const subsByThing = new Map<string, Subscription[]>()
    for (const s of d.subscriptions) {
      for (const thingId of s.coversThingIds) {
        const list = subsByThing.get(thingId) ?? []
        list.push(s)
        subsByThing.set(thingId, list)
      }
    }

    const life = new Map<string, Lifecycle>()
    for (const t of d.things) life.set(t.id, lifecycle(t, byThing.get(t.id) ?? []))

    const events = buildHorizon(d, { memberId: focusId })
    const names = new Map(all.members.map((m) => [m.id, m.name]))

    return {
      ...d,
      ready: raw !== undefined,
      members: [...all.members].sort((a, b) => a.name.localeCompare(b.name)),
      devices: all.devices,
      userIds: userIds(all.devices, all.members),
      deviceId,
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
      memberName: (id) => (id ? names.get(id) ?? null : null),
    }
    // `mu` is the multi-user snapshot string: it changing is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, mu])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
