// The glance snapshot: one small, self-describing object that answers "what
// should a surface outside the app show?". Home-screen widgets, the Electron
// tray popup, GLANCElauncher cards and MCP tools should all read THIS rather
// than re-deriving anything, so every surface agrees with the app.
//
// It is plain JSON on purpose: a native shell can persist it for a widget, a
// headless refresh can hand it to the launcher, and an MCP tool can return it
// as-is.

import type { DataSet, Day, EventType, Severity, Subscription, Thing } from './types'
import { today } from './dates'
import { attentionQueue, buildHorizon } from './horizon'
import { lifecycle, replacementFund, type Verdict } from './health'
import { handlerOfEvent, visibleTo } from './household'
import { eventLink } from './links'
import { monthlyCost } from './money'
import { capReminders, planReminders, type Reminder, type ReminderPrefs } from './reminders'

// THE SHAPE BELOW IS A CONTRACT (docs/snapshot.md). Native widgets, the tray,
// the launcher and MCP tools are separate programs that read a stored copy of
// this object, sometimes one written by an older or newer build of the app.
//   - Adding a field is fine and keeps the version. Readers ignore what they
//     do not know.
//   - Removing or renaming a field, or changing what one means or its type,
//     is breaking: bump SNAPSHOT_VERSION and say so in docs/snapshot.md.
// snapshot.test.ts pins the field list, so a change here fails a test until
// that decision has been made on purpose.
export const SNAPSHOT_VERSION = 1

export interface GlanceSnapshot {
  version: typeof SNAPSHOT_VERSION
  generatedAt: string
  day: Day
  // ISO 4217 code for every amount in the snapshot. Nothing is converted.
  currency: string
  // Whose device this was built for (null: nobody has claimed it), and the
  // member the dated lists were narrowed to (null: everyone).
  scope: { viewerId: string | null; memberId: string | null }
  counts: { things: number; subscriptions: number; attention: number; urgent: number }
  burn: { monthly: number; yearly: number; replacementMonthly: number }
  // What needs a decision, most pressing first, then what is coming.
  attention: SnapshotEvent[]
  upcoming: SnapshotEvent[]
  things: SnapshotThing[]
  // The notifications this device should have pending, soonest first
  // (core/reminders.ts). A shell schedules exactly these and cancels the rest.
  reminders: Reminder[]
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
  // The member who deals with it, or null when it falls to nobody.
  handlerId: string | null
  // What a tap opens (core/links.ts).
  link: string
}

export interface SnapshotThing {
  id: string
  name: string
  category: string
  verdict: Verdict
  // Share of its window left (0..1), the day the window closes, and the days
  // until then. All null when the thing has no dates yet.
  remaining: number | null
  lifeEnd: Day | null
  daysLeft: number | null
  // Null for the household.
  ownerMemberId: string | null
}

export interface SnapshotOptions {
  // The member this device belongs to (null: nobody). Private items of other
  // members never reach a snapshot, so no widget, tray or tool can show them.
  viewerId: string | null
  // Narrow the dated events to what concerns one member.
  memberId?: string | null
  // Members who use the app: decides who each date falls to, and so which
  // reminders are this device's. Left out, every date falls to nobody.
  userIds?: Iterable<string>
  currency?: string
  reminderPrefs?: ReminderPrefs
  // A ceiling on `reminders` (iOS keeps 64 pending per app; the family uses 56).
  maxReminders?: number
  ref?: Day
  // "Now" for generatedAt and for planning reminders, epoch milliseconds.
  now?: number
  limit?: number
}

export function buildSnapshot(all: DataSet, opts: SnapshotOptions): GlanceSnapshot {
  const ref = opts.ref ?? today()
  const now = opts.now ?? Date.now()
  const limit = opts.limit ?? 8
  const users = new Set(opts.userIds ?? [])
  const data = visibleTo(all, opts.viewerId)
  const events = buildHorizon(data, { ref, memberId: opts.memberId })
  const queue = attentionQueue(events)
  const thingById = new Map<string, Thing>(data.things.map((t) => [t.id, t]))
  const subById = new Map<string, Subscription>(data.subscriptions.map((s) => [s.id, s]))
  const slim = (e: (typeof events)[number]): SnapshotEvent => ({
    key: e.key, type: e.type, date: e.date, days: e.days, severity: e.severity, title: e.title, detail: e.detail,
    thingId: e.thingId, subscriptionId: e.subscriptionId, amount: e.amount,
    handlerId: handlerOfEvent(e, thingById, subById, users),
    link: eventLink(e.key),
  })
  const active = data.things.filter((t) => t.status === 'active')
  const monthly = data.subscriptions.reduce((t, s) => t + monthlyCost(s), 0)
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: new Date(now).toISOString(),
    day: ref,
    currency: opts.currency ?? 'USD',
    scope: { viewerId: opts.viewerId, memberId: opts.memberId ?? null },
    counts: {
      things: active.length,
      subscriptions: data.subscriptions.filter((s) => s.status !== 'cancelled').length,
      attention: queue.length,
      urgent: queue.filter((e) => e.severity === 'urgent' || e.severity === 'past').length,
    },
    burn: { monthly, yearly: monthly * 12, replacementMonthly: replacementFund(active, data.coverages, ref).monthly },
    attention: queue.slice(0, limit).map(slim),
    upcoming: events.filter((e) => e.days >= 0 && !e.quiet && !e.repeat).slice(0, limit).map(slim),
    things: active.map((t) => {
      const life = lifecycle(t, data.coverages, ref)
      return { id: t.id, name: t.name, category: t.category, verdict: life.verdict, remaining: life.remaining, lifeEnd: life.lifeEnd, daysLeft: life.daysLeft ?? null, ownerMemberId: t.ownerMemberId }
    }),
    reminders: capReminders(planReminders(all, { meId: opts.viewerId, users, prefs: opts.reminderPrefs, now }), opts.maxReminders ?? 56),
  }
}
