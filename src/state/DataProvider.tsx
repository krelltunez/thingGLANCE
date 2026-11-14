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
import { concernsPlan, concernsThing, handlerOfEvent, memberOfDevice, needsSomeone, userIds, visibleTo } from '@/core/household'
import { getDeviceId } from '@/sync/deviceId'
import { DataContext, type DataValue } from './data'
import { getFocusMemberId, householdSnapshot, subscribeHousehold } from '@/multiuser/settings'

const EMPTY: DataSet & { members: Member[]; devices: DeviceLink[] } = { things: [], coverages: [], subscriptions: [], decisions: [], members: [], devices: [] }

export function DataProvider({ children }: { children: ReactNode }) {
  const raw = useLiveQuery(async () => {
    const [things, coverages, subscriptions, decisions, members, devices] = await Promise.all([
      db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.members.toArray(), db.devices.toArray(),
    ])
    return { things, coverages, subscriptions, decisions, members, devices }
  }, [])
  const mu = useSyncExternalStore(subscribeHousehold, householdSnapshot)

  const value = useMemo<DataValue>(() => {
    const all = raw ?? EMPTY
    const multiUser = all.members.length > 1
    const deviceId = getDeviceId()
    const meId = memberOfDevice(all.devices, deviceId, all.members)
    // A filter left pointing at someone who has since been removed is no filter.
    const stored = getFocusMemberId()
    const focusId = multiUser && stored && all.members.some((m) => m.id === stored) ? stored : null

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
    const users = userIds(all.devices, all.members)

    return {
      ...d,
      ready: raw !== undefined,
      members: [...all.members].sort((a, b) => a.name.localeCompare(b.name)),
      devices: all.devices,
      userIds: users,
      deviceId,
      multiUser,
      meId,
      focusId,
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
      handlerOf: (e) => handlerOfEvent(e, thingById, subById, users),
      needsSomeone: (e) => needsSomeone(handlerOfEvent(e, thingById, subById, users), users),
      memberName: (id) => (id ? names.get(id) ?? null : null),
    }
    // `mu` is the household-preferences snapshot string: it changing is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, mu])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}
