// Reminders as pure logic: which dates on the horizon are worth a
// notification, when each one fires, and on whose device.
//
// Nothing here schedules anything. A shell (Capacitor local notifications,
// the Electron main process, a headless refresh) asks planReminders() what
// this device should have pending and makes the platform match: schedule what
// is new, cancel what is gone. The ids are stable, so that is a plain diff.
//
// Like buildSnapshot(), this applies privacy itself: another member's private
// items never produce a reminder here, whatever is passed in.

import dayjs from 'dayjs'
import type { DataSet, Day, EventType, HorizonEvent, Subscription, Thing } from './types'
import { DAY, addDays, fmtDay, relative } from './dates'
import { buildHorizon } from './horizon'
import { handlerOfEvent, visibleTo } from './household'
import { eventLink } from './links'
import { tr } from './text'

// Each date gets at most two nudges. The first comes when it enters its lead
// window (LEAD_DAYS in horizon.ts: the same moment it joins the queue), while
// there is still time to act. The second is a last call this many days before
// the date itself, sized to what acting takes: a claim or an extension for
// coverage, shopping around for a replacement, a cancellation for a renewal.
export const LAST_CALL_DAYS: Record<EventType, number> = {
  'coverage-end': 7,
  'support-end': 30,
  replace: 30,
  renewal: 3,
  'trial-end': 2,
  'sub-end': 3,
}

export type ReminderStage = 'heads-up' | 'last-call'

export interface ReminderPrefs {
  enabled: boolean
  // When in the day a reminder fires, device local time.
  hour: number
  minute: number
  // A kind set to false is never notified. Missing means on.
  kinds: Partial<Record<EventType, boolean>>
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { enabled: true, hour: 9, minute: 0, kinds: {} }

// Preferences as they come from wherever a shell keeps them: possibly partial,
// possibly out of range. Anything unusable falls back to the default, so a
// stray value can never move a reminder to the wrong day or break the plan.
export function normalizeReminderPrefs(input: unknown): ReminderPrefs {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<ReminderPrefs>
  const whole = (v: unknown, max: number, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback
  const kinds: ReminderPrefs['kinds'] = {}
  if (p.kinds && typeof p.kinds === 'object') {
    for (const type of Object.keys(LAST_CALL_DAYS) as EventType[]) if (p.kinds[type] === false) kinds[type] = false
  }
  return {
    enabled: p.enabled !== false,
    hour: whole(p.hour, 23, DEFAULT_REMINDER_PREFS.hour),
    minute: whole(p.minute, 59, DEFAULT_REMINDER_PREFS.minute),
    kinds,
  }
}

export interface Reminder {
  // Stable across runs: the event's key plus the stage. Scheduling the same
  // reminder twice replaces it; a reminder missing from the next plan is
  // cancelled.
  id: string
  eventKey: string
  type: EventType
  stage: ReminderStage
  // When it fires: epoch milliseconds, and the same moment as a local day.
  at: number
  day: Day
  // The date it is about, and how far ahead of it this fires.
  eventDate: Day
  daysBefore: number
  title: string
  body: string
  // What a tap opens (core/links.ts).
  link: string
  thingId?: string
  subscriptionId?: string
  amount?: number
}

export interface ReminderContext {
  // The member this device belongs to, or null when nobody has claimed it.
  meId: string | null
  // Members who use the app (core/household: userIds).
  users: Set<string>
  prefs?: ReminderPrefs
  // "Now", epoch milliseconds. Reminders at or before it are not planned: a
  // date already inside its window is in the queue, and a burst of catch-up
  // notifications on first run would help nobody.
  now?: number
  // How far ahead to plan, in days. Every sync re-plans, so this only has to
  // outlast the longest gap between two runs of the app.
  horizonDays?: number
}

// Who is told about a date. If someone deals with it (core/household:
// handlerOfEvent), only their devices. If it falls to nobody, every device,
// claimed or not. A device nobody has claimed hears only about those.
export function tellsDevice(handler: string | null, meId: string | null): boolean {
  return handler === null || handler === meId
}

// A reminder would be noise for a date that is already settled, was handed to
// dayGLANCE (which reminds in its own way), is a routine renewal nobody asked
// to review. (A later occurrence of a short-cycle plan under review is kept:
// lists show only the next one, but a phone that is not opened for a month
// still has to be told about the one after.)
function worthReminding(e: HorizonEvent, prefs: ReminderPrefs): boolean {
  if (prefs.kinds[e.type] === false) return false
  if (e.quiet || e.lead < 0 || e.days < 0) return false
  const state = e.decision?.state
  return state !== 'dismissed' && state !== 'done' && state !== 'sent'
}

function text(e: HorizonEvent, daysBefore: number): { title: string; body: string } {
  const when = daysBefore === 0 ? tr('reminder.today') : tr('reminder.when', { relative: relative(daysBefore), date: fmtDay(e.date, 'MMM D') })
  return { title: e.title, body: tr('reminder.body', { detail: e.detail, when }) }
}

export function planReminders(all: DataSet, ctx: ReminderContext): Reminder[] {
  const prefs = normalizeReminderPrefs(ctx.prefs)
  if (!prefs.enabled) return []
  const now = ctx.now ?? Date.now()
  const ref = dayjs(now).format(DAY)
  const data = visibleTo(all, ctx.meId)
  // Who deals with a plan can depend on a thing this device may not see (a
  // shared plan on someone's private phone). The answer has to be the same on
  // every device, so it is worked out over everything; only the handler's id
  // comes out of it.
  const thingById = new Map<string, Thing>(all.things.map((t) => [t.id, t]))
  const subById = new Map<string, Subscription>(data.subscriptions.map((s) => [s.id, s]))
  const events = buildHorizon(data, { ref, from: ref, to: addDays(ref, ctx.horizonDays ?? 400), allThings: all.things })

  const out: Reminder[] = []
  for (const e of events) {
    if (!worthReminding(e, prefs)) continue
    if (!tellsDevice(handlerOfEvent(e, thingById, subById, ctx.users), ctx.meId)) continue
    const lastCall = LAST_CALL_DAYS[e.type]
    // A weekly plan's lead window is the whole week: its heads-up would land
    // on the previous renewal. One nudge a week is the most that is useful.
    const weekly = e.type === 'renewal' && (e.subscriptionId ? subById.get(e.subscriptionId)?.cycle : undefined) === 'weekly'
    const stages: [ReminderStage, number][] = lastCall < e.lead && !weekly ? [['heads-up', e.lead], ['last-call', lastCall]] : [['last-call', Math.min(lastCall, e.lead)]]
    for (const [stage, daysBefore] of stages) {
      const day = addDays(e.date, -daysBefore)
      const at = dayjs(day).hour(prefs.hour).minute(prefs.minute).second(0).millisecond(0).valueOf()
      if (at <= now) continue
      out.push({
        id: `${e.key}@${stage}`, eventKey: e.key, type: e.type, stage, at, day, eventDate: e.date, daysBefore,
        ...text(e, daysBefore), link: eventLink(e.key), thingId: e.thingId, subscriptionId: e.subscriptionId, amount: e.amount,
      })
    }
  }
  return out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
}

// iOS keeps at most 64 pending notifications per app and silently drops the
// rest, so a shell passes its ceiling here (lastGLANCE uses 56). What is kept
// is what fires soonest: every later run plans again and pulls the next ones
// in as the near ones fire.
export function capReminders(list: Reminder[], max: number): Reminder[] {
  return list.length <= max ? list : [...list].sort((a, b) => a.at - b.at).slice(0, max)
}

// Native notification ids are 32-bit ints. This maps a reminder id to a stable
// positive one (the hash lastGLANCE uses for its chores), so scheduling a
// reminder again replaces it in place instead of stacking a duplicate.
export function reminderNumericId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0
  return (h & 0x7fffffff) || 1
}
