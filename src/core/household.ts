// Household rules: whose a thing is, who deals with it, who may see it.
//
// A member is anyone the household tracks things for. A user is a member with
// at least one device attached ("this is me"). Everything here is pure and
// takes the device's own member as an argument, so the same rules can run in
// the app, a widget snapshot, the tray or an MCP tool.
//
// The roster itself (who exists) is the shared `glance-users` vault app. See
// docs/household-members.md.

import type { DataSet, Day, DeviceLink, HorizonEvent, Member, OwnershipSpan, Subscription, Thing } from './types'
import { monthlyCost } from './money'

// ── Who is a user ────────────────────────────────────────────────────────────

// Links whose member is no longer on the roster count for nothing.
export function userIds(links: DeviceLink[], members: Member[]): Set<string> {
  const known = new Set(members.map((m) => m.id))
  return new Set(links.map((l) => l.memberId).filter((id) => known.has(id)))
}

export function memberOfDevice(links: DeviceLink[], deviceId: string, members: Member[]): string | null {
  const id = links.find((l) => l.id === deviceId)?.memberId
  return id && members.some((m) => m.id === id) ? id : null
}

// ── Who may see it ───────────────────────────────────────────────────────────

// `viewerId` is the member this device belongs to, or null when it belongs to
// nobody. A private thing shows only to its owner, a private plan only to its
// payer. This hides; it does not encrypt.
export const canSeeThing = (t: Thing, viewerId: string | null): boolean =>
  t.visibility !== 'private' || (!!viewerId && t.ownerMemberId === viewerId)

export const canSeePlan = (s: Subscription, viewerId: string | null): boolean =>
  s.visibility !== 'private' || (!!viewerId && s.payerMemberId === viewerId)

// The dataset as one device is allowed to see it. Everything a surface shows
// should be derived from this, never from the raw tables. Coverage follows its
// thing. A shared plan attached to a hidden thing stays, and simply cannot
// name it.
export function visibleTo(data: DataSet, viewerId: string | null): DataSet {
  const hidden = new Set(data.things.filter((t) => !canSeeThing(t, viewerId)).map((t) => t.id))
  if (hidden.size === 0 && data.subscriptions.every((s) => canSeePlan(s, viewerId))) return data
  return {
    things: data.things.filter((t) => !hidden.has(t.id)),
    coverages: data.coverages.filter((c) => !hidden.has(c.thingId)),
    subscriptions: data.subscriptions.filter((s) => canSeePlan(s, viewerId)),
    decisions: data.decisions,
  }
}

// ── Whose it is (the member filter) ──────────────────────────────────────────

// A thing concerns a member when they own it, when they are the one who deals
// with it, or when it belongs to the household and so to everyone.
export const concernsThing = (t: Thing, memberId: string): boolean =>
  t.ownerMemberId === null || t.ownerMemberId === memberId || t.responsibleMemberId === memberId

// A plan concerns a member when they pay for it, handle it or are covered by
// it. A household-paid plan follows the things it is attached to; one that is
// attached to nothing is everyone's.
export function concernsPlan(s: Subscription, memberId: string, thingById: Map<string, Thing>): boolean {
  if (s.payerMemberId === memberId || s.responsibleMemberId === memberId || s.coversMemberIds.includes(memberId)) return true
  if (s.payerMemberId !== null) return false
  const things = s.coversThingIds.map((id) => thingById.get(id)).filter((t): t is Thing => !!t)
  return things.length === 0 || things.some((t) => concernsThing(t, memberId))
}

// ── Who is asked ─────────────────────────────────────────────────────────────

// The member whose devices should be asked about an item's dates. Null means
// nobody is assigned (or the one assigned no longer has a device), so every
// user is asked and the item needs someone.
export function responsibleFor(item: Pick<Thing | Subscription, 'responsibleMemberId'>, users: Set<string>): string | null {
  return item.responsibleMemberId && users.has(item.responsibleMemberId) ? item.responsibleMemberId : null
}

// Who actually deals with a thing: whoever was picked, or failing that its
// owner, if they use the app. Most things are never assigned to anyone, and
// "the person whose phone it is" is who everyone would expect to be asked.
// (The task sent to dayGLANCE goes to the same person.)
export function handlerOfThing(t: Thing, users: Set<string>): string | null {
  return responsibleFor(t, users) ?? (t.ownerMemberId && users.has(t.ownerMemberId) ? t.ownerMemberId : null)
}

// A plan: whoever was picked, else whoever pays, else whoever deals with a
// thing it is attached to (the person who handles the phone handles its plan).
export function handlerOfPlan(s: Subscription, thingById: Map<string, Thing>, users: Set<string>): string | null {
  const own = responsibleFor(s, users) ?? (s.payerMemberId && users.has(s.payerMemberId) ? s.payerMemberId : null)
  if (own) return own
  for (const id of s.coversThingIds) {
    const t = thingById.get(id)
    const via = t ? handlerOfThing(t, users) : null
    if (via) return via
  }
  return null
}

// Who deals with a date on the horizon: the plan's handler for a plan's
// renewal or end, the thing's for everything else. This is also who a reminder
// for it will go to.
export function handlerOfEvent(
  e: Pick<HorizonEvent, 'thingId' | 'subscriptionId'>,
  thingById: Map<string, Thing>, subById: Map<string, Subscription>, users: Set<string>,
): string | null {
  const s = e.subscriptionId ? subById.get(e.subscriptionId) : undefined
  if (s) return handlerOfPlan(s, thingById, users)
  const t = e.thingId ? thingById.get(e.thingId) : undefined
  return t ? handlerOfThing(t, users) : null
}

// With two or more users, an item nobody is assigned to is asked of everyone,
// which in practice means each assumes the other has it. With one user there
// is nobody to confuse.
export const needsSomeone = (handler: string | null, users: Set<string>): boolean => users.size >= 2 && handler === null

// ── Hand-me-downs ────────────────────────────────────────────────────────────

// Changing the owner keeps the thing and everything hanging off it, and
// records who had it before. Two same-day cases are corrections, not history:
// an owner who held it for no time at all leaves no trace, and handing it
// straight back undoes the hand-over.
export function handDown(thing: Thing, to: string | null, day: Day): Pick<Thing, 'ownerMemberId' | 'ownershipHistory'> {
  const history: OwnershipSpan[] = thing.ownershipHistory ?? []
  if (to === thing.ownerMemberId) return { ownerMemberId: to, ownershipHistory: thing.ownershipHistory }
  const last = history[history.length - 1]
  let next: OwnershipSpan[]
  if (last && last.to === day && last.memberId === to) {
    next = history.slice(0, -1)
  } else {
    const from = last?.to ?? thing.purchaseDate ?? thing.createdAt.slice(0, 10)
    next = from >= day ? history : [...history, { memberId: thing.ownerMemberId, from, to: day }]
  }
  return { ownerMemberId: to, ownershipHistory: next.length ? next : undefined }
}

// ── Removing a member ────────────────────────────────────────────────────────

export interface MemberTies {
  owns: number
  pays: number
  responsible: number
}

// What still points at a member. They cannot be removed while any of it does:
// reassign first, so nothing is left belonging to nobody by accident.
export function memberTies(memberId: string, data: Pick<DataSet, 'things' | 'subscriptions'>): MemberTies {
  return {
    owns: data.things.filter((t) => t.ownerMemberId === memberId).length,
    pays: data.subscriptions.filter((s) => s.payerMemberId === memberId).length,
    responsible:
      data.things.filter((t) => t.responsibleMemberId === memberId).length +
      data.subscriptions.filter((s) => s.responsibleMemberId === memberId).length,
  }
}

export const isTied = (t: MemberTies): boolean => t.owns + t.pays + t.responsible > 0

export function describeTies(t: MemberTies): string {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const parts = [
    t.owns ? `owns ${n(t.owns, 'thing', 'things')}` : '',
    t.pays ? `pays for ${n(t.pays, 'plan', 'plans')}` : '',
    t.responsible ? `is responsible for ${n(t.responsible, 'item', 'items')}` : '',
  ].filter(Boolean)
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Handing a member's things and plans to someone else (or to the household),
// which is what clears the way to remove them. Each answers the fields that
// change, or null when the item has nothing to do with `from`.
//
// Private follows the same rule as everywhere else: it needs a user to be
// private to. Handed to the household, or to a member with no device, a
// private item becomes shared rather than hidden from every device.
export function reassignThing(t: Thing, from: string, to: string | null, users: Set<string>): Partial<Pick<Thing, 'ownerMemberId' | 'responsibleMemberId' | 'visibility'>> | null {
  const out: Partial<Pick<Thing, 'ownerMemberId' | 'responsibleMemberId' | 'visibility'>> = {}
  if (t.ownerMemberId === from) {
    out.ownerMemberId = to
    if (t.visibility === 'private' && !(to && users.has(to))) out.visibility = 'shared'
  }
  if (t.responsibleMemberId === from) out.responsibleMemberId = to && users.has(to) ? to : null
  return Object.keys(out).length ? out : null
}

export function reassignPlan(s: Subscription, from: string, to: string | null, users: Set<string>): Partial<Pick<Subscription, 'payerMemberId' | 'responsibleMemberId' | 'visibility'>> | null {
  const out: Partial<Pick<Subscription, 'payerMemberId' | 'responsibleMemberId' | 'visibility'>> = {}
  if (s.payerMemberId === from) {
    out.payerMemberId = to
    if (s.visibility === 'private' && !(to && users.has(to))) out.visibility = 'shared'
  }
  if (s.responsibleMemberId === from) out.responsibleMemberId = to && users.has(to) ? to : null
  return Object.keys(out).length ? out : null
}

// How many of a member's things and plans are private to them. Nobody else can
// see these, so whoever removes the member has to be told they exist.
export const privateHeld = (memberId: string, data: Pick<DataSet, 'things' | 'subscriptions'>): number =>
  data.things.filter((t) => t.visibility === 'private' && t.ownerMemberId === memberId).length +
  data.subscriptions.filter((s) => s.visibility === 'private' && s.payerMemberId === memberId).length

// ── Totals by member ─────────────────────────────────────────────────────────
// Keyed by member id, with null for the household.

// What each payer's plans come to a month.
export function planCostByPayer(subs: Subscription[]): Map<string | null, number> {
  const out = new Map<string | null, number>()
  for (const s of subs) {
    const m = monthlyCost(s)
    if (m > 0) out.set(s.payerMemberId, (out.get(s.payerMemberId) ?? 0) + m)
  }
  return out
}

// The monthly upgrade-fund target split by who owns each thing. Takes the rows
// replacementFund() answers; a thing already due adds nothing to a monthly
// target, as there.
export function fundByOwner(rows: { thing: Thing; monthly: number; monthsLeft: number }[]): Map<string | null, number> {
  const out = new Map<string | null, number>()
  for (const r of rows) {
    if (r.monthsLeft <= 0) continue
    out.set(r.thing.ownerMemberId, (out.get(r.thing.ownerMemberId) ?? 0) + r.monthly)
  }
  return out
}
