// Household rules: whose a thing is, who deals with it, who may see it.
//
// A member is anyone the household tracks things for. A user is a member with
// at least one device attached ("this is me"). Everything here is pure and
// takes the device's own member as an argument, so the same rules can run in
// the app, a widget snapshot, the tray or an MCP tool.
//
// The roster itself (who exists) is the shared `glance-users` vault app. See
// docs/household-members.md.

import type { DataSet, Day, DeviceLink, Member, OwnershipSpan, Subscription, Thing } from './types'

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
