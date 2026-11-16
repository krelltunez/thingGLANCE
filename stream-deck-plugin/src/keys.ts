// What each key shows (docs/stream-deck.md), as pure functions of the app's
// state (DeckState, electron/deckModel.ts). The actions draw these with
// render.ts and act on what they return; nothing here touches Stream Deck.
//
// Not connected (state null) and connected but not ready (the app has not sent
// its first snapshot) each read as what they are, never as "nothing waiting".
// The words on the keys are English only: Stream Deck gives a plugin no
// language of the app's, and the keys carry little text. Names and titles
// come from the app, in its language.

import type { DeckEvent, DeckState, DeckThing } from '../../electron/deckProtocol';
import { CATEGORY_ICON, EVENT_ICON, ICON_ADD, ICON_CALENDAR, ICON_CLEAR, ICON_OFFLINE, ICON_THING, ICON_WAITING } from './keyIcons';

export interface KeyView {
  /** The main line: a countdown, a name, or a big number. */
  title: string;
  sub?: string;
  /** A Lucide icon name (keyIcons.ts). */
  icon?: string | null;
  accent: string;
  /** The bar along the bottom, 0..1; none when null. */
  ratio?: number | null;
  /** Greyed: nothing to act on. */
  dim?: boolean;
  /** The title is a number or a countdown, drawn large. */
  big?: boolean;
  /** A small mark in the top corner: where this key is in its list ("2/5"). */
  badge?: string;
}

export const GREY = '#64748b';
export const GREEN = '#22c55e';
export const AMBER = '#f59e0b';
export const RED = '#ef4444';
/** thingGLANCE's sky blue. */
export const SKY = '#7dd3fc';
export const VIOLET = '#a78bfa';

export const OFFLINE: KeyView = { title: 'thingGLANCE', sub: 'Not running', icon: ICON_OFFLINE, accent: GREY, dim: true };
export const NOT_READY: KeyView = { title: 'thingGLANCE', sub: 'Open the app', icon: ICON_WAITING, accent: GREY, dim: true };

/** Trim to `max` characters, with an ellipsis when cut. */
export function fit(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** The app's countdown (src/core/dates.ts, tMinus): "T-42d" before a date, "T+12d" after it. */
export function tMinus(days: number): string {
  if (days === 0) return 'T-0';
  const abs = Math.abs(days);
  const sign = days > 0 ? '-' : '+';
  if (abs < 60) return `T${sign}${abs}d`;
  if (abs < 730) return `T${sign}${Math.round(abs / 30.44)}mo`;
  return `T${sign}${Number((abs / 365.25).toFixed(1))}y`;
}

/** How pressing a date is, as a colour: red when past or urgent, amber when soon, sky further off. */
export function severityColor(severity: string): string {
  return severity === 'past' || severity === 'urgent' ? RED : severity === 'soon' ? AMBER : SKY;
}

/** Where a thing is in its life, as a colour. */
export function verdictColor(verdict: string): string {
  if (verdict === 'prime' || verdict === 'solid') return GREEN;
  if (verdict === 'watch') return AMBER;
  if (verdict === 'replace' || verdict === 'overdue') return RED;
  return GREY;
}

/** An amount as the app writes it, in its currency and language; a plain number if the tags are not usable. */
export function money(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount);
  } catch {
    return String(Math.round(amount * 100) / 100);
  }
}

const wrap = (index: number, count: number): number => ((index % count) + count) % count;
const waitingOn = (state: DeckState | null): KeyView | null => (state === null ? OFFLINE : !state.ready ? NOT_READY : null);

function eventView(e: DeckEvent, index: number, count: number): KeyView {
  return {
    title: tMinus(e.days),
    sub: e.detail || e.title,
    icon: EVENT_ICON[e.type] ?? ICON_CALENDAR,
    accent: e.state === 'sent' ? SKY : severityColor(e.severity),
    big: true,
    ...(count > 1 ? { badge: `${index + 1}/${count}` } : {}),
  };
}

export interface EventKey { view: KeyView; index: number; count: number; event: DeckEvent | null }

/** The Queue key: the dates waiting on a decision, one at a time, most pressing first. */
export function queueKey(state: DeckState | null, index: number): EventKey {
  const wait = waitingOn(state);
  if (wait || !state) return { view: wait ?? OFFLINE, index: 0, count: 0, event: null };
  if (state.queue.length === 0) return { view: { title: 'All clear', sub: 'Nothing waiting', icon: ICON_CLEAR, accent: GREEN }, index: 0, count: 0, event: null };
  const i = wrap(index, state.queue.length);
  return { view: eventView(state.queue[i], i, state.queue.length), index: i, count: state.queue.length, event: state.queue[i] };
}

/** The Coming up key: the dates ahead that are not in the queue, soonest first. */
export function comingUpKey(state: DeckState | null, index: number): EventKey {
  const wait = waitingOn(state);
  if (wait || !state) return { view: wait ?? OFFLINE, index: 0, count: 0, event: null };
  if (state.upcoming.length === 0) return { view: { title: 'Coming up', sub: 'Nothing ahead', icon: ICON_CALENDAR, accent: GREY, dim: true }, index: 0, count: 0, event: null };
  const i = wrap(index, state.upcoming.length);
  return { view: eventView(state.upcoming[i], i, state.upcoming.length), index: i, count: state.upcoming.length, event: state.upcoming[i] };
}

/** The Waiting key: how many dates are waiting on a decision, big. */
export function waitingKey(state: DeckState | null): KeyView {
  const wait = waitingOn(state);
  if (wait || !state) return wait ?? OFFLINE;
  if (state.waiting === 0) return { title: '0', sub: 'All clear', accent: GREEN, big: true };
  const urgent = state.queue.some((e) => e.severity === 'past' || e.severity === 'urgent');
  return { title: String(state.waiting), sub: 'waiting', accent: urgent ? RED : AMBER, big: true };
}

/** The Charges key: what the plans will charge over the days ahead. */
export function chargesKey(state: DeckState | null): KeyView {
  const wait = waitingOn(state);
  if (wait || !state) return wait ?? OFFLINE;
  const { total, count, days } = state.charges;
  if (count === 0) return { title: 'Plans', sub: `Nothing in ${days}d`, icon: EVENT_ICON.renewal, accent: GREY, dim: true };
  return { title: fit(money(total, state.currency, state.locale), 9), sub: `next ${days}d · ${count}`, icon: EVENT_ICON.renewal, accent: VIOLET };
}

/** The thing a Thing key shows: the chosen one, or with none chosen the one closest to the end of its window. */
export function pickThing(state: DeckState, thingId: string | null): DeckThing | null {
  if (thingId) return state.things.find((t) => t.id === thingId) ?? null;
  const dated = state.things.filter((t) => t.daysLeft !== null);
  return dated.sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))[0] ?? state.things[0] ?? null;
}

/** The Thing key: one thing, how long it has left, and the bar of its window still ahead. */
export function thingKey(state: DeckState | null, thingId: string | null): { view: KeyView; thing: DeckThing | null } {
  const wait = waitingOn(state);
  if (wait || !state) return { view: wait ?? OFFLINE, thing: null };
  const thing = pickThing(state, thingId);
  if (!thing) {
    return { view: thingId ? { title: 'Thing', sub: 'No longer tracked', icon: ICON_THING, accent: GREY, dim: true } : { title: 'Thing', sub: 'No things yet', icon: ICON_THING, accent: GREY, dim: true }, thing: null };
  }
  return {
    view: {
      title: thing.name,
      sub: thing.daysLeft === null ? thing.verdictLabel : `${tMinus(thing.daysLeft)} · ${thing.verdictLabel}`,
      icon: CATEGORY_ICON[thing.category] ?? ICON_THING,
      accent: verdictColor(thing.verdict),
      ratio: thing.remaining,
    },
    thing,
  };
}

/** The Add a thing key. */
export function addKey(state: DeckState | null): KeyView {
  return state === null ? OFFLINE : { title: 'Add', sub: 'a thing', icon: ICON_ADD, accent: SKY };
}
