// The glance snapshot: one small, self-describing object that answers "what
// should a surface outside the app show?". Home-screen widgets, the Electron
// tray popup, GLANCElauncher cards and MCP tools should all read THIS rather
// than re-deriving anything, so every surface agrees with the app.
//
// It is plain JSON on purpose: a native shell can persist it for a widget, a
// headless refresh can hand it to the launcher, and an MCP tool can return it
// as-is.

import type { DataSet, Day, EventType, Severity } from './types'
import { today } from './dates'
import { attentionQueue, buildHorizon } from './horizon'
import { lifecycle, replacementFund, type Verdict } from './health'
import { monthlyCost } from './money'

export const SNAPSHOT_VERSION = 1

export interface GlanceSnapshot {
  version: typeof SNAPSHOT_VERSION
  generatedAt: string
  day: Day
  counts: { things: number; subscriptions: number; attention: number; urgent: number }
  burn: { monthly: number; yearly: number; replacementMonthly: number }
  attention: SnapshotEvent[]
  upcoming: SnapshotEvent[]
  things: { id: string; name: string; category: string; verdict: Verdict; remaining: number | null; lifeEnd: Day | null }[]
}

export interface SnapshotEvent {
  key: string
  type: EventType
  date: Day
  days: number
  severity: Severity
  title: string
  detail: string
  thingId?: string
  subscriptionId?: string
  amount?: number
}

export function buildSnapshot(data: DataSet, opts: { userId?: string | null; ref?: Day; limit?: number } = {}): GlanceSnapshot {
  const ref = opts.ref ?? today()
  const limit = opts.limit ?? 8
  const events = buildHorizon(data, { ref, userId: opts.userId })
  const queue = attentionQueue(events)
  const slim = ({ key, type, date, days, severity, title, detail, thingId, subscriptionId, amount }: (typeof events)[number]): SnapshotEvent =>
    ({ key, type, date, days, severity, title, detail, thingId, subscriptionId, amount })
  const active = data.things.filter((t) => t.status === 'active')
  const monthly = data.subscriptions.reduce((t, s) => t + monthlyCost(s), 0)
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    day: ref,
    counts: {
      things: active.length,
      subscriptions: data.subscriptions.filter((s) => s.status !== 'cancelled').length,
      attention: queue.length,
      urgent: queue.filter((e) => e.severity === 'urgent' || e.severity === 'past').length,
    },
    burn: { monthly, yearly: monthly * 12, replacementMonthly: replacementFund(active, data.coverages, ref).monthly },
    attention: queue.slice(0, limit).map(slim),
    upcoming: events.filter((e) => e.days >= 0).slice(0, limit).map(slim),
    things: active.map((t) => {
      const life = lifecycle(t, data.coverages, ref)
      return { id: t.id, name: t.name, category: t.category, verdict: life.verdict, remaining: life.remaining, lifeEnd: life.lifeEnd }
    }),
  }
}
