// The Stream Deck wire protocol (docs/stream-deck.md), version 1: what the
// app's listener (streamDeckServer.ts) sends and accepts. The plugin
// (stream-deck-plugin/) imports this file, so it stays free of Node and
// Electron: plain types, constants and the parser. After lastGLANCE's
// electron/deckProtocol.ts.
//
// Out, app to plugin:
//   tg:state   everything the keys draw (DeckState), on connect and on change
//   tg:token   a session token for the plugin's property inspector (below)
//   tg:result  the answer to one command, by its clientId
// In, plugin to app:
//   tg:auth          a page (Origin) proves it holds a token, first frame
//   tg:event:decide  "Done with this" on one date in the queue
//   tg:open          show the app, at a link it can open
//
// Trust (dayGLANCE's model, kept on purpose): a client without an Origin is a
// native process, the plugin's Node backend, and is trusted at once; it gets a
// token. A client with an Origin (a browser, the plugin's property inspector)
// must send tg:auth with a live token as its first frame within five seconds,
// or it is dropped. That keeps a web page from driving the socket.

export const DECK_PROTOCOL_VERSION = 1;
export const STREAM_DECK_PORT = 7911;

export const MSG_STATE = 'tg:state';
export const MSG_TOKEN = 'tg:token';
export const MSG_RESULT = 'tg:result';
export const MSG_AUTH = 'tg:auth';
export const MSG_DECIDE = 'tg:event:decide';
export const MSG_OPEN = 'tg:open';

/** A frame larger than this is refused by the listener. */
export const MAX_FRAME_BYTES = 16 * 1024;

export type DeckSeverity = 'past' | 'urgent' | 'soon' | 'later';

/** A date on the horizon, as a key draws it. */
export interface DeckEvent {
  key: string;
  /** coverage-end, support-end, replace, renewal, trial-end or sub-end. */
  type: string;
  /** Already a sentence in the app's language: "Manufacturer warranty ends". */
  title: string;
  /** What it is about: the thing's or the plan's name. */
  detail: string;
  /** The local day, YYYY-MM-DD. */
  date: string;
  /** Days from today to it, by the clock now; negative once it has passed. */
  days: number;
  severity: DeckSeverity;
  /** open, sent (handed to dayGLANCE), done or dismissed. */
  state: string;
  amount: number | null;
  /** What opens it in the app. */
  link: string;
}

/** A thing in service, for the Thing key and its picker. */
export interface DeckThing {
  id: string;
  name: string;
  category: string;
  /** prime, solid, watch, replace, overdue, retired or unknown. */
  verdict: string;
  /** The app's word for the verdict, in its language. */
  verdictLabel: string;
  /** The earlier of support ending and the planned replacement; null with no dates. */
  lifeEnd: string | null;
  /** Days from today to lifeEnd, by the clock now. */
  daysLeft: number | null;
  /** 0 to 1 of its window still ahead; null with no dates. */
  remaining: number | null;
  link: string;
}

export interface DeckState {
  v: typeof DECK_PROTOCOL_VERSION;
  type: typeof MSG_STATE;
  /** When this state was built (ISO). */
  at: string;
  /** False until the app has sent its first snapshot: the keys say "open thingGLANCE", not "nothing waiting". */
  ready: boolean;
  /** How many dates are waiting on a decision (the queue can be longer than what is listed). */
  waiting: number;
  /** The dates waiting on a decision, most pressing first. */
  queue: DeckEvent[];
  /** The dates ahead that are not in the queue, soonest first. */
  upcoming: DeckEvent[];
  things: DeckThing[];
  /** Plan charges over the next `days` days. */
  charges: { days: number; total: number; count: number };
  /** ISO 4217, for the amounts. */
  currency: string;
  /** A BCP 47 tag, for formatting amounts as the app does. */
  locale: string;
}

export interface DeckTokenMessage { v: typeof DECK_PROTOCOL_VERSION; type: typeof MSG_TOKEN; token: string }

export type DeckResultReason = 'unknown_event' | 'too_soon' | 'invalid' | 'refused';
export interface DeckResult { v: typeof DECK_PROTOCOL_VERSION; type: typeof MSG_RESULT; clientId: string; ok: boolean; reason?: DeckResultReason }

export type DeckCommand =
  | { type: typeof MSG_AUTH; token: string }
  | { type: typeof MSG_DECIDE; key: string; clientId: string }
  | { type: typeof MSG_OPEN; target: string | null; clientId: string };

const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
// A date's key is its kind, the row it belongs to and its day.
const KEY_RE = /^[A-Za-z0-9_.:-]{1,300}$/;

/**
 * One inbound frame as a command, or null for anything else: unparseable, too
 * large, a type outside the protocol, or fields of the wrong shape. Nothing is
 * forwarded unchecked.
 */
export function parseDeckCommand(raw: unknown): DeckCommand | null {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array) text = new TextDecoder().decode(raw);
  else return null;
  if (text.length > MAX_FRAME_BYTES) return null;
  let msg: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    msg = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const clientId = typeof msg.clientId === 'string' && ID_RE.test(msg.clientId) ? msg.clientId : null;
  switch (msg.type) {
    case MSG_AUTH:
      return typeof msg.token === 'string' && /^[0-9a-f]{32}$/.test(msg.token) ? { type: MSG_AUTH, token: msg.token } : null;
    case MSG_DECIDE:
      return typeof msg.key === 'string' && KEY_RE.test(msg.key) && clientId ? { type: MSG_DECIDE, key: msg.key, clientId } : null;
    case MSG_OPEN:
      if (!clientId) return null;
      if (msg.target === null || msg.target === undefined) return { type: MSG_OPEN, target: null, clientId };
      return typeof msg.target === 'string' && msg.target.length <= 2000 ? { type: MSG_OPEN, target: msg.target, clientId } : null;
    default:
      return null;
  }
}
