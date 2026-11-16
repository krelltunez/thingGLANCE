import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FIRED_MEMORY_MS, MAX_TIMER_MS, MISSED_WINDOW_MS, createReminderScheduler, parseReminder, parseWords, type PlannedReminder, type ReminderWords } from './reminderScheduler';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const T0 = Date.parse('2026-11-16T09:00:00Z');
const HOUR = 60 * 60 * 1000;
const reminder = (id: string, at: number): PlannedReminder => ({ id, at, title: `Title ${id}`, body: 'Body', link: `thingglance://event/${id}`, eventKey: id });
const WORDS = { done: 'Done with this', send: 'Send to dayGLANCE', canSend: true };

function setup(file?: string) {
  let dir = '';
  if (!file) { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-reminders-')); dirs.push(dir); }
  const clock = { now: T0 };
  const fired: { r: PlannedReminder; words: ReminderWords }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const target = file ?? path.join(dir, 'reminders.json');
  const s = createReminderScheduler({
    file: target,
    fire: (r, words) => fired.push({ r, words }),
    now: () => clock.now,
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (h) => { const i = timers.indexOf(h as { fn: () => void; ms: number }); if (i >= 0) timers.splice(i, 1); },
  });
  /** Let time pass and run whatever timer is armed. */
  const advance = (ms: number) => { clock.now += ms; const t = timers.shift(); t?.fn(); };
  return { s, clock, fired, timers, file: target, advance };
}

describe('the desktop reminder scheduler', () => {
  it('makes its schedule the plan, soonest first, and arms for the next one', () => {
    const { s, timers } = setup();
    expect(s.sync([reminder('b', T0 + 3 * HOUR), reminder('a', T0 + 30 * 60 * 1000)], WORDS)).toBe(2);
    expect(s.pending().map((r) => r.id)).toEqual(['a', 'b']);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(30 * 60 * 1000);
  });

  it('never waits more than an hour, so a clock change or a missed resume is caught', () => {
    const { s, timers } = setup();
    s.sync([reminder('far', T0 + 48 * HOUR)], WORDS);
    expect(timers[0].ms).toBe(MAX_TIMER_MS);
  });

  it('fires a reminder at its time, with the words it was planned with, and takes it off the schedule', () => {
    const { s, fired, advance } = setup();
    s.sync([reminder('a', T0 + HOUR)], WORDS);
    advance(HOUR);
    expect(fired.map((f) => f.r.id)).toEqual(['a']);
    expect(fired[0].words).toEqual(WORDS);
    expect(s.pending()).toEqual([]);
  });

  it('drops what a new plan no longer has, and takes what it adds', () => {
    const { s } = setup();
    s.sync([reminder('a', T0 + HOUR), reminder('b', T0 + 2 * HOUR)], WORDS);
    s.sync([reminder('b', T0 + 2 * HOUR), reminder('c', T0 + 3 * HOUR)], WORDS);
    expect(s.pending().map((r) => r.id)).toEqual(['b', 'c']);
    s.sync([], WORDS);
    expect(s.pending()).toEqual([]);
  });

  it('keeps the plan across a restart, and fires what came due while the app was closed', () => {
    const first = setup();
    first.s.sync([reminder('a', T0 + HOUR), reminder('b', T0 + 5 * HOUR)], WORDS);
    const second = setup(first.file);
    second.clock.now = T0 + 2 * HOUR;
    second.s.rearm();
    expect(second.fired.map((f) => f.r.id)).toEqual(['a']);
    expect(second.s.pending().map((r) => r.id)).toEqual(['b']);
  });

  it('drops a reminder missed by more than twelve hours without showing it', () => {
    const first = setup();
    first.s.sync([reminder('old', T0 + HOUR)], WORDS);
    const second = setup(first.file);
    second.clock.now = T0 + HOUR + MISSED_WINDOW_MS + 1;
    second.s.rearm();
    expect(second.fired).toEqual([]);
    expect(second.s.pending()).toEqual([]);
  });

  it('fires what is due before a late plan replaces it', () => {
    const { s, clock, fired } = setup();
    s.sync([reminder('a', T0 + HOUR)], WORDS);
    // The machine slept through the timer; the page's next plan arrives first.
    clock.now = T0 + 2 * HOUR;
    s.sync([reminder('b', T0 + 5 * HOUR)], WORDS);
    expect(fired.map((f) => f.r.id)).toEqual(['a']);
    expect(s.pending().map((r) => r.id)).toEqual(['b']);
  });

  it('does not fire twice when a plan built just before the time arrives just after', () => {
    const { s, fired, advance, clock } = setup();
    const a = reminder('a', T0 + HOUR);
    s.sync([a], WORDS);
    advance(HOUR);
    clock.now += 1000;
    s.sync([a], WORDS);
    s.rearm();
    expect(fired).toHaveLength(1);
    expect(s.pending()).toEqual([]);
  });

  it('forgets a fired reminder after a day, so the same date can remind again next year', () => {
    const { s, fired, advance, clock } = setup();
    s.sync([reminder('a', T0 + HOUR)], WORDS);
    advance(HOUR);
    clock.now += FIRED_MEMORY_MS + HOUR;
    const later = reminder('late', clock.now + HOUR);
    s.sync([later], WORDS);
    advance(HOUR);
    expect(fired.map((f) => f.r.id)).toEqual(['a', 'late']);
    expect(JSON.parse(fs.readFileSync(path.join(dirs[dirs.length - 1], 'reminders.json'), 'utf-8')).fired).not.toHaveProperty(`a|${T0 + HOUR}`);
  });

  it('survives a reminder that cannot be shown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-reminders-')); dirs.push(dir);
    let clock = T0;
    const logged: string[] = [];
    const s = createReminderScheduler({ file: path.join(dir, 'r.json'), fire: () => { throw new Error('no notifications here'); }, now: () => clock, setTimer: () => null, clearTimer: () => {}, log: (m) => logged.push(m) });
    s.sync([reminder('a', T0 + HOUR), reminder('b', T0 + 3 * HOUR)], WORDS);
    clock = T0 + 2 * HOUR;
    expect(() => s.rearm()).not.toThrow();
    expect(logged[0]).toContain('could not show');
    expect(s.pending().map((r) => r.id)).toEqual(['b']);
  });

  it('reads a corrupt file as an empty plan', () => {
    const { file } = setup();
    fs.writeFileSync(file, '{oops');
    const again = setup(file);
    expect(again.s.pending()).toEqual([]);
  });
});

describe('what the scheduler accepts', () => {
  it('takes a reminder as the snapshot carries it, and only the fields it uses', () => {
    const r = { id: 'k@last-call', eventKey: 'k', type: 'renewal', stage: 'last-call', at: T0, day: '2026-11-16', eventDate: '2026-11-19', daysBefore: 3, title: 'Plan renews', body: 'Netflix, in 3 days', link: 'thingglance://event/k' };
    expect(parseReminder(r)).toEqual({ id: 'k@last-call', eventKey: 'k', at: T0, title: 'Plan renews', body: 'Netflix, in 3 days', link: 'thingglance://event/k' });
  });

  it.each([
    ['no id', { ...reminder('a', T0), id: '' }],
    ['no time', { ...reminder('a', T0), at: 'soon' }],
    ['a link that is not the app\'s', { ...reminder('a', T0), link: 'https://example.com/' }],
    ['no date to act on', { ...reminder('a', T0), eventKey: undefined }],
    ['not an object', 'reminder'],
  ])('refuses one with %s', (_what, value) => { expect(parseReminder(value)).toBeNull(); });

  it('has English for the buttons until the page sends its own, and never offers Send unless told', () => {
    expect(parseWords(undefined)).toEqual({ done: 'Done with this', send: 'Send to dayGLANCE', canSend: false });
    expect(parseWords({ done: 'Erledigt', send: 'An dayGLANCE senden', canSend: true })).toEqual({ done: 'Erledigt', send: 'An dayGLANCE senden', canSend: true });
    expect(parseWords({ canSend: 'yes' }).canSend).toBe(false);
  });
});
