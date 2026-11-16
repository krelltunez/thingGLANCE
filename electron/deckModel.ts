// What the Stream Deck shows (docs/stream-deck.md), as a pure function of the
// payload the tray already holds (trayModel.ts), what was done here that the
// app has not reflected yet, and the clock. No new push from the page: the
// deck reads what the tray reads.
//
// The clock matters because the payload is only rebuilt when the data changes
// (and every 15 minutes): a countdown must still turn at midnight with the
// window closed. So each date's `days` and each thing's `daysLeft` are counted
// again from its day, in this machine's zone, which is the user's.
//
// The guard below keeps one date from being settled twice from here in a
// minute: a press only ever marks it done, and a second press, or a press just
// after the tray's, is answered too_soon. After lastGLANCE's deckModel.ts.

import { acceptDeepLink } from './deepLink.js';
import { trayState, type DoneHere, type TrayPayload } from './trayModel.js';
import { DECK_PROTOCOL_VERSION, MSG_STATE, type DeckEvent, type DeckSeverity, type DeckState, type DeckThing } from './deckProtocol.js';

const DAY_MS = 86_400_000;
export const DECK_DECIDE_WINDOW_MS = 60_000;
export const DECK_EVENT_LIMIT = 40;
export const DECK_THING_LIMIT = 500;

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((e): e is Row => !!e && typeof e === 'object') : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const SEVERITIES: readonly string[] = ['past', 'urgent', 'soon', 'later'];

/** Whole calendar days from today (at `now`, local) to a local day; null for anything that is not one. */
export function daysUntil(day: unknown, now: number): number | null {
  const m = typeof day === 'string' ? DAY_RE.exec(day) : null;
  if (!m) return null;
  const today = new Date(now);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const to = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  // Rounded: a day with a clock change is 23 or 25 hours long.
  return Math.round((to - from) / DAY_MS);
}

function event(e: Row, now: number): DeckEvent | null {
  const key = str(e.key), link = str(e.link), date = str(e.date);
  const days = daysUntil(date, now);
  if (!key || !link || days === null) return null;
  // A date that has passed since the snapshot was made reads as passed.
  const severity = days < 0 ? 'past' : SEVERITIES.includes(str(e.severity)) ? str(e.severity) as DeckSeverity : 'later';
  return { key, type: str(e.type), title: str(e.title), detail: str(e.detail), date, days, severity, state: str(e.state, 'open'), amount: num(e.amount), link };
}

function thing(t: Row, now: number, verdicts: Row): DeckThing | null {
  const id = str(t.id), name = str(t.name);
  if (!id || !name) return null;
  const verdict = str(t.verdict, 'unknown');
  const lifeEnd = typeof t.lifeEnd === 'string' && DAY_RE.test(t.lifeEnd) ? t.lifeEnd : null;
  return {
    id, name, category: str(t.category), verdict, verdictLabel: str(verdicts[verdict], verdict),
    lifeEnd, daysLeft: lifeEnd ? daysUntil(lifeEnd, now) : null, remaining: num(t.remaining),
    link: `thingglance://thing/${encodeURIComponent(id)}`,
  };
}

const EMPTY: Omit<DeckState, 'v' | 'type' | 'at'> = { ready: false, waiting: 0, queue: [], upcoming: [], things: [], charges: { days: 30, total: 0, count: 0 }, currency: 'USD', locale: 'en-US' };

export function deckState(payload: TrayPayload | null, here: DoneHere, now: number): DeckState {
  const head = { v: DECK_PROTOCOL_VERSION, type: MSG_STATE, at: new Date(now).toISOString() } as const;
  const state = trayState(payload, here);
  if (!state.payload) return { ...head, ...EMPTY };
  const snapshot = state.payload.snapshot as Row;
  const labels = state.payload.labels as Row;
  const verdicts = (labels.verdicts && typeof labels.verdicts === 'object' ? labels.verdicts : {}) as Row;
  const queue = rows(snapshot.attention).map((e) => event(e, now)).filter((e): e is DeckEvent => e !== null).slice(0, DECK_EVENT_LIMIT);
  const queued = new Set(queue.map((e) => e.key));
  const charges = (snapshot.charges && typeof snapshot.charges === 'object' ? snapshot.charges : {}) as Row;
  return {
    ...head,
    ready: true,
    waiting: state.waiting,
    queue,
    upcoming: rows(snapshot.upcoming).map((e) => event(e, now)).filter((e): e is DeckEvent => e !== null && !queued.has(e.key) && e.state === 'open' && e.days >= 0).slice(0, DECK_EVENT_LIMIT),
    things: rows(snapshot.things).map((t) => thing(t, now, verdicts)).filter((t): t is DeckThing => t !== null).slice(0, DECK_THING_LIMIT),
    charges: { days: num(charges.days) ?? 30, total: num(charges.total) ?? 0, count: num(charges.count) ?? 0 },
    currency: str(snapshot.currency, 'USD'),
    locale: str(snapshot.locale, 'en-US'),
  };
}

/**
 * Whether a press may settle this date: it must be in the queue the app last
 * sent, and not settled from here in the last minute. Two records count, since
 * neither alone holds for the whole minute:
 *  - `pressed`, the deck's own presses, kept the full minute whatever happens;
 *  - `decidedHere`, ticks made here (the deck or the tray), which are dropped
 *    once a snapshot made after them no longer lists the date.
 */
export function deckDecision(
  key: string,
  payload: TrayPayload | null,
  decidedHere: ReadonlyMap<string, number>,
  now: number,
  pressed: ReadonlyMap<string, number> = new Map(),
  windowMs = DECK_DECIDE_WINDOW_MS,
): 'ok' | 'unknown_event' | 'too_soon' {
  const recent = (at: number | undefined) => at !== undefined && Number.isFinite(at) && now - at >= 0 && now - at < windowMs;
  if (recent(pressed.get(key)) || recent(decidedHere.get(key))) return 'too_soon';
  return payload?.attention.some((e) => e.key === key) ? 'ok' : 'unknown_event';
}

/** The presses still inside the window, so the record stays small. */
export function prunePresses(pressed: Map<string, number>, now: number, windowMs = DECK_DECIDE_WINDOW_MS): void {
  for (const [key, at] of pressed) if (now - at >= windowMs || now < at) pressed.delete(key);
}

/**
 * What a key may open: just the app (null), or a thingglance:// link, which
 * the page reads like a link from anywhere else. False for anything that is
 * not one, which is refused rather than guessed.
 */
export function deckOpenLink(target: string | null): string | null | false {
  if (target === null) return null;
  return acceptDeepLink(target) ?? false;
}
