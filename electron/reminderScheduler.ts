// The desktop reminder scheduler (docs/desktop.md, "Reminders").
//
// Which dates notify, when and on whose device is decided in the app
// (src/core/reminders.ts) and travels in the snapshot as `reminders`. This
// only makes the desktop match that plan, as Android's ReminderScheduler does:
// every snapshot the page pushes replaces the schedule. Nothing is scheduled
// from the page.
//
//  - The plan persists to userData/reminders.json, with the words its buttons
//    use, so a reminder still fires after a relaunch, before the page is up.
//  - One timer is armed for the next reminder due, never more than an hour
//    out: a long timeout would drift across a sleep or a clock change, and the
//    hour cap re-checks the wall clock. Main also re-arms on resume and unlock.
//  - On launch or resume, a reminder whose time passed within the last 12
//    hours fires once; older ones are dropped silently.
//  - A reminder that has fired is remembered for a day, so a snapshot built a
//    moment before its time, arriving a moment after, cannot fire it twice.
//
// After lastGLANCE's electron/reminderScheduler.ts, whose page schedules by
// diff; here the plan arrives whole.

import fs from 'node:fs';
import { writeFileAtomicSync } from './atomicWrite.js';

export const REMINDERS_FILE = 'reminders.json';
export const MISSED_WINDOW_MS = 12 * 60 * 60 * 1000;
export const MAX_TIMER_MS = 60 * 60 * 1000;
export const REMINDER_LIMIT = 1000;
export const FIRED_MEMORY_MS = 24 * 60 * 60 * 1000;
const LINK = /^thingglance:\/\//i;

export interface PlannedReminder {
  /** The plan's own id: the date's key and the stage. */
  id: string;
  /** Epoch ms. */
  at: number;
  title: string;
  body: string;
  /** What a click opens (src/core/links.ts). */
  link: string;
  /** The date it is about: what "Done" and "Send" act on. */
  eventKey: string;
}

/** What the notification's buttons say, and whether "Send to dayGLANCE" is offered at all. */
export interface ReminderWords {
  done: string;
  send: string;
  canSend: boolean;
}

export const DEFAULT_WORDS: ReminderWords = { done: 'Done with this', send: 'Send to dayGLANCE', canSend: false };

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** A reminder from the snapshot or the file, or null if malformed. */
export function parseReminder(v: unknown): PlannedReminder | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (!str(r.id, 400) || !str(r.eventKey, 300)) return null;
  if (!str(r.title, 500) || typeof r.body !== 'string' || r.body.length > 2000) return null;
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  if (!str(r.link, 2000) || !LINK.test(r.link)) return null;
  return { id: r.id, at: r.at, title: r.title, body: r.body, link: r.link, eventKey: r.eventKey };
}

export function parseWords(v: unknown): ReminderWords {
  const w = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return {
    done: str(w.done, 100) ? w.done : DEFAULT_WORDS.done,
    send: str(w.send, 100) ? w.send : DEFAULT_WORDS.send,
    canSend: w.canSend === true,
  };
}

export interface ReminderSchedulerDeps {
  file: string;
  fire: (reminder: PlannedReminder, words: ReminderWords) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (message: string) => void;
}

interface Saved { reminders: PlannedReminder[]; words: ReminderWords; fired: Record<string, number> }

export function createReminderScheduler(deps: ReminderSchedulerDeps) {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;

  const load = (): Saved => {
    try {
      const parsed = JSON.parse(fs.readFileSync(deps.file, 'utf-8')) as Record<string, unknown>;
      const reminders = Array.isArray(parsed.reminders) ? parsed.reminders.map(parseReminder).filter((r): r is PlannedReminder => r !== null) : [];
      const fired: Record<string, number> = {};
      if (parsed.fired && typeof parsed.fired === 'object') {
        for (const [id, at] of Object.entries(parsed.fired as Record<string, unknown>)) if (typeof at === 'number') fired[id] = at;
      }
      return { reminders, words: parseWords(parsed.words), fired };
    } catch {
      return { reminders: [], words: { ...DEFAULT_WORDS }, fired: {} };
    }
  };
  let state = load();
  const save = () => {
    try { writeFileAtomicSync(deps.file, JSON.stringify(state)); } catch { /* kept in memory */ }
  };
  const firedKey = (r: PlannedReminder) => `${r.id}|${r.at}`;

  /** Fire what is due (missed within the window once, older dropped). True when anything left the plan. */
  const fireDue = (): boolean => {
    const t = now();
    const due = state.reminders.filter((r) => r.at <= t).sort((a, b) => a.at - b.at);
    if (due.length === 0) return false;
    state.reminders = state.reminders.filter((r) => r.at > t);
    for (const r of due) {
      if (state.fired[firedKey(r)] !== undefined) continue;
      if (t - r.at <= MISSED_WINDOW_MS) {
        state.fired[firedKey(r)] = t;
        try { deps.fire(r, state.words); } catch (e) { deps.log?.(`reminder ${r.id}: could not show: ${e instanceof Error ? e.message : String(e)}`); }
      } else {
        deps.log?.(`reminder ${r.id}: missed by more than 12 h, dropped`);
      }
    }
    for (const [key, at] of Object.entries(state.fired)) if (t - at > FIRED_MEMORY_MS) delete state.fired[key];
    return true;
  };

  const arm = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
    let next = Infinity;
    for (const r of state.reminders) next = Math.min(next, r.at);
    if (next === Infinity) return;
    timer = setTimer(() => { timer = null; rearm(); }, Math.max(0, Math.min(next - now(), MAX_TIMER_MS)));
  };

  function rearm(): void {
    if (fireDue()) save();
    arm();
  }

  return {
    /**
     * Make the schedule the plan. What was due under the old one fires first, so
     * a plan that arrives late cannot swallow a reminder. Returns how many are
     * now pending.
     */
    sync(plan: unknown, words: unknown): number {
      fireDue();
      const list = Array.isArray(plan) ? plan.map(parseReminder).filter((r): r is PlannedReminder => r !== null) : [];
      const t = now();
      // A reminder at or before now is not the plan's to bring back: it has
      // fired here, or was never worth firing late.
      state.reminders = list.filter((r) => r.at > t && state.fired[firedKey(r)] === undefined).sort((a, b) => a.at - b.at).slice(0, REMINDER_LIMIT);
      state.words = parseWords(words);
      save();
      arm();
      return state.reminders.length;
    },
    /** What is scheduled, soonest first. */
    pending(): PlannedReminder[] {
      return [...state.reminders].sort((a, b) => a.at - b.at);
    },
    rearm,
    stop(): void {
      if (timer !== null) { clearTimer(timer); timer = null; }
    },
    /** Re-read the file (tests; a second process never writes it). */
    reload(): void { state = load(); },
  };
}

export type ReminderScheduler = ReturnType<typeof createReminderScheduler>;
