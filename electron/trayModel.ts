// The tray's data and layout (docs/desktop.md, "The tray"). The tray never
// opens the database or runs sync: the main window pushes the same payload
// Android's widgets are handed (src/native/widgetBridge.ts: the snapshot, the
// words a surface adds of its own, and whether dayGLANCE can be sent to), main
// keeps it, and a "Done" queues a write (commandQueue.ts) that the page
// applies. Until the page's next snapshot shows it, the date is hidden here,
// as a tick on a widget row is.
//
// Pure functions, tested without Electron; main.ts owns the Tray, the popup
// window and the Linux menu. The layout helpers are lastGLANCE's
// (electron/trayModel.ts), after dayGLANCE's electron/trayPopup.ts.

import { parseWords, type ReminderWords } from './reminderScheduler.js';

export const PAYLOAD_MAX_BYTES = 4 * 1024 * 1024;
export const TRAY_MENU_LIMIT = 8;
// A date ticked here that a snapshot still lists this long after was refused
// (it is gone, or the write failed): show it again rather than hide it for good.
export const DECIDED_HERE_MS = 60_000;

/** A date as the tray's menu and the main process need it. The popup reads the snapshot itself. */
export interface TrayEvent {
  key: string;
  title: string;
  detail: string;
  link: string;
  state: string;
}

export interface TrayPayload {
  /** When the snapshot was made, epoch ms. */
  generatedAt: number;
  /** The page's payload, as it sent it, less the launcher's share. */
  payload: { snapshot: Record<string, unknown>; labels: Record<string, unknown>; canSend: boolean };
  attention: TrayEvent[];
  /** The reminder plan, for the scheduler (reminderScheduler.ts reads each entry). */
  reminders: unknown[];
  words: ReminderWords;
}

const text = (v: unknown, max = 500): string | null => (typeof v === 'string' && v.length <= max ? v : null);

function parseEvent(v: unknown): TrayEvent | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>;
  const key = text(e.key, 300), title = text(e.title), link = text(e.link, 2000);
  if (!key || title === null || !link) return null;
  return { key, title, detail: text(e.detail) ?? '', link, state: text(e.state, 20) ?? 'open' };
}

/** The payload the main window pushed, or null if it is not one. */
export function parseTrayPayload(json: unknown): TrayPayload | null {
  if (typeof json !== 'string' || json.length > PAYLOAD_MAX_BYTES) return null;
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return null; }
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const snapshot = p.snapshot as Record<string, unknown> | null;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const generatedAt = typeof snapshot.generatedAt === 'string' ? Date.parse(snapshot.generatedAt) : NaN;
  if (!Number.isFinite(generatedAt) || !Array.isArray(snapshot.attention) || !Array.isArray(snapshot.upcoming)) return null;
  const labels = p.labels && typeof p.labels === 'object' && !Array.isArray(p.labels) ? p.labels as Record<string, unknown> : {};
  const canSend = p.canSend === true;
  return {
    generatedAt,
    payload: { snapshot, labels, canSend },
    attention: snapshot.attention.map(parseEvent).filter((e): e is TrayEvent => e !== null),
    reminders: Array.isArray(snapshot.reminders) ? snapshot.reminders : [],
    words: parseWords({ done: labels.done, send: labels.send, canSend }),
  };
}

/** What was done from outside the window and has not shown up in a snapshot yet: a date's key, and when. */
export interface DoneHere {
  decided: ReadonlyMap<string, number>;
  sent: ReadonlyMap<string, number>;
}

export interface TrayState {
  /** False until the main window has pushed a snapshot. */
  ready: boolean;
  /** How many dates are waiting on a decision, less the ones ticked here. */
  waiting: number;
  /** The first few of them, for the menu. */
  attention: TrayEvent[];
  /** What the popup draws: the payload, with what was done here already applied. */
  payload: TrayPayload['payload'] | null;
}

type Row = Record<string, unknown>;
const rows = (v: unknown): Row[] => (Array.isArray(v) ? v.filter((e): e is Row => !!e && typeof e === 'object') : []);

/** The payload as it will look once the page has applied what was done here. */
export function trayState(p: TrayPayload | null, here: DoneHere, limit = TRAY_MENU_LIMIT): TrayState {
  if (!p) return { ready: false, waiting: 0, attention: [], payload: null };
  const { snapshot } = p.payload;
  const sentHere = (e: Row): Row => (here.sent.has(e.key as string) && (e.state ?? 'open') === 'open' ? { ...e, state: 'sent' } : e);
  const all = rows(snapshot.attention);
  const attention = all.filter((e) => !here.decided.has(e.key as string)).map(sentHere);
  const upcoming = rows(snapshot.upcoming).map((e) => (here.decided.has(e.key as string) ? { ...e, state: 'done' } : sentHere(e)));
  const counts = (snapshot.counts && typeof snapshot.counts === 'object' ? snapshot.counts : {}) as Row;
  const total = typeof counts.attention === 'number' ? counts.attention : all.length;
  const waiting = Math.max(0, total - (all.length - attention.length));
  return {
    ready: true,
    waiting,
    attention: p.attention.filter((e) => !here.decided.has(e.key)).slice(0, limit).map((e) => (here.sent.has(e.key) && e.state === 'open' ? { ...e, state: 'sent' } : e)),
    payload: { ...p.payload, snapshot: { ...snapshot, attention, upcoming, counts: { ...counts, attention: waiting } } },
  };
}

/**
 * The keys done here that no longer need hiding: a snapshot made after the
 * tick no longer lists the date (decided) or shows it handed over (sent), or
 * the tick is old enough that the page must have refused it.
 */
export function settledHere(here: ReadonlyMap<string, number>, p: TrayPayload, kind: 'decided' | 'sent', now: number): string[] {
  const byKey = new Map(p.attention.map((e) => [e.key, e]));
  return [...here].filter(([key, at]) => {
    if (now - at > DECIDED_HERE_MS) return true;
    if (p.generatedAt < at) return false;
    const event = byKey.get(key);
    return kind === 'decided' ? !event : !event || event.state !== 'open';
  }).map(([key]) => key);
}

/** A date the tray shows, by its key: what "Done" and "Send" may act on. */
export function trayEvent(p: TrayPayload | null, key: unknown): TrayEvent | null {
  if (typeof key !== 'string' || !p) return null;
  return p.attention.find((e) => e.key === key) ?? null;
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Where the popup goes: centered on the tray icon, below it when the icon is
 * in the top half of the screen (the macOS menu bar, a top panel), above it
 * otherwise (the Windows taskbar), kept inside the work area.
 */
export function popupPosition(icon: Rect, size: { width: number; height: number }, workArea: Rect, gap = 6): { x: number; y: number } {
  const below = icon.y + icon.height / 2 < workArea.y + workArea.height / 2;
  let x = Math.round(icon.x + icon.width / 2 - size.width / 2);
  let y = below ? icon.y + icon.height + gap : icon.y - size.height - gap;
  x = Math.min(Math.max(x, workArea.x + gap), workArea.x + workArea.width - size.width - gap);
  y = Math.min(Math.max(y, workArea.y + gap), workArea.y + workArea.height - size.height - gap);
  return { x, y };
}

/**
 * On Windows a click on the tray icon while the popup is open first takes
 * focus from the popup (blur hides it) and only then delivers the click, which
 * would find the popup hidden and show it again: the icon could rarely close
 * its own popup. A click this soon after a blur-hide is that same click, so it
 * leaves the popup closed.
 */
export const BLUR_CLICK_WINDOW_MS = 300;

export function isClickAfterBlurHide(now: number, lastBlurHideAt: number | null): boolean {
  return lastBlurHideAt != null && now - lastBlurHideAt >= 0 && now - lastBlurHideAt < BLUR_CLICK_WINDOW_MS;
}

export interface TrayMenuLabels {
  open: string;
  quit: string;
  done: string;
  nothingWaiting: string;
}

export type TrayMenuItem =
  | { kind: 'open' | 'quit' | 'separator' | 'empty'; label?: string }
  | { kind: 'event'; label: string; key: string; link: string; done: string; open: string };

/**
 * The Linux tray menu (AppIndicator delivers no reliable clicks, so no
 * popup): Open, the dates waiting on a decision each with Done, Quit. Also
 * the right-click menu elsewhere, without the dates.
 */
export function trayMenuItems(state: TrayState, labels: TrayMenuLabels, withEvents: boolean): TrayMenuItem[] {
  const items: TrayMenuItem[] = [{ kind: 'open', label: labels.open }];
  if (withEvents) {
    items.push({ kind: 'separator' });
    if (state.attention.length === 0) items.push({ kind: 'empty', label: labels.nothingWaiting });
    for (const e of state.attention) {
      items.push({ kind: 'event', label: e.detail ? `${e.title} · ${e.detail}` : e.title, key: e.key, link: e.link, done: labels.done, open: labels.open });
    }
  }
  items.push({ kind: 'separator' }, { kind: 'quit', label: labels.quit });
  return items;
}
