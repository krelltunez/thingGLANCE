import { describe, expect, it } from 'vitest';
import { DECK_DECIDE_WINDOW_MS, daysUntil, deckDecision, deckOpenLink, deckState, prunePresses } from './deckModel';
import { parseDeckCommand, MAX_FRAME_BYTES } from './deckProtocol';
import { parseTrayPayload } from './trayModel';

// 9:00 on Monday 16 November 2026, local time.
const NOW = new Date(2026, 10, 16, 9, 0, 0).getTime();
const event = (key: string, date: string, over: Record<string, unknown> = {}) => ({ key, type: 'coverage-end', date, days: 99, severity: 'soon', title: 'Warranty ends', detail: `Thing ${key}`, state: 'open', link: `thingglance://event/${key}`, ...over });
const payload = (attention = [event('a', '2026-11-25'), event('b', '2026-12-08')]) => parseTrayPayload(JSON.stringify({
  snapshot: {
    generatedAt: '2026-11-16T08:00:00.000Z', currency: 'CAD', locale: 'en-CA',
    counts: { attention: attention.length },
    attention,
    upcoming: [event('a', '2026-11-25'), event('z', '2027-02-01', { type: 'renewal', amount: 119 }), event('old', '2026-11-10'), event('gone', '2026-12-20', { state: 'done' })],
    things: [{ id: 't 1', name: 'Pixel 9', category: 'phone', verdict: 'prime', lifeEnd: '2031-08-01', remaining: 0.8 }, { id: 't2', name: 'TV', category: 'tv', verdict: 'replace', lifeEnd: null, remaining: null }, { name: 'no id' }],
    charges: { days: 30, total: 134.99, count: 2, items: [], months: [] },
    reminders: [],
  },
  labels: { done: 'Done with this', verdicts: { prime: 'Prime', replace: 'Plan its replacement' } },
  canSend: false,
}))!;
const none = { decided: new Map<string, number>(), sent: new Map<string, number>() };

describe('counting days by the clock, not by the snapshot', () => {
  it('counts calendar days in this machine\'s zone', () => {
    expect(daysUntil('2026-11-16', NOW)).toBe(0);
    expect(daysUntil('2026-11-25', NOW)).toBe(9);
    expect(daysUntil('2026-11-10', NOW)).toBe(-6);
    // Late in the evening it is still today.
    expect(daysUntil('2026-11-17', new Date(2026, 10, 16, 23, 59).getTime())).toBe(1);
  });
  it('is not thrown by a day with a clock change in between', () => {
    expect(daysUntil('2027-03-20', new Date(2027, 2, 10, 12).getTime())).toBe(10);
  });
  it('answers null for anything that is not a day', () => {
    expect(daysUntil('soon', NOW)).toBeNull();
    expect(daysUntil(undefined, NOW)).toBeNull();
  });
});

describe('what the keys are shown', () => {
  it('says the app has not been opened, until it has', () => {
    expect(deckState(null, none, NOW)).toMatchObject({ v: 1, type: 'tg:state', ready: false, waiting: 0, queue: [], things: [] });
  });

  it('lists the queue with the days counted now, and what comes after it', () => {
    const s = deckState(payload(), none, NOW);
    expect(s).toMatchObject({ ready: true, waiting: 2, currency: 'CAD', locale: 'en-CA', charges: { days: 30, total: 134.99, count: 2 } });
    expect(s.queue.map((e) => [e.key, e.days])).toEqual([['a', 9], ['b', 22]]);
    // Not what is already in the queue, not what has passed, not what is settled.
    expect(s.upcoming.map((e) => e.key)).toEqual(['z']);
    expect(s.upcoming[0]).toMatchObject({ type: 'renewal', amount: 119, link: 'thingglance://event/z' });
  });

  it('turns a countdown at midnight with nothing new from the app', () => {
    const tomorrow = NOW + 15 * 60 * 60 * 1000 + 60_000;
    expect(deckState(payload(), none, tomorrow).queue.map((e) => e.days)).toEqual([8, 21]);
  });

  it('reads a date that has passed since the snapshot as passed', () => {
    const later = new Date(2026, 10, 26, 9).getTime();
    expect(deckState(payload(), none, later).queue[0]).toMatchObject({ key: 'a', days: -1, severity: 'past' });
  });

  it('hides a date ticked here at once', () => {
    const s = deckState(payload(), { decided: new Map([['a', NOW]]), sent: new Map() }, NOW);
    expect(s.waiting).toBe(1);
    expect(s.queue.map((e) => e.key)).toEqual(['b']);
  });

  it('lists the things with the app\'s word for each verdict and a link to open', () => {
    const s = deckState(payload(), none, NOW);
    expect(s.things).toEqual([
      { id: 't 1', name: 'Pixel 9', category: 'phone', verdict: 'prime', verdictLabel: 'Prime', lifeEnd: '2031-08-01', daysLeft: daysUntil('2031-08-01', NOW), remaining: 0.8, link: 'thingglance://thing/t%201' },
      { id: 't2', name: 'TV', category: 'tv', verdict: 'replace', verdictLabel: 'Plan its replacement', lifeEnd: null, daysLeft: null, remaining: null, link: 'thingglance://thing/t2' },
    ]);
  });
});

describe('a press', () => {
  it('settles a date that is in the queue', () => {
    expect(deckDecision('a', payload(), new Map(), NOW)).toBe('ok');
  });
  it('is refused for a date the app did not list', () => {
    expect(deckDecision('nope', payload(), new Map(), NOW)).toBe('unknown_event');
    expect(deckDecision('a', null, new Map(), NOW)).toBe('unknown_event');
  });
  it('does not settle the same date twice in a minute, from the deck or after the tray', () => {
    expect(deckDecision('a', payload(), new Map(), NOW, new Map([['a', NOW - 1000]]))).toBe('too_soon');
    expect(deckDecision('a', payload(), new Map([['a', NOW - 1000]]), NOW)).toBe('too_soon');
    expect(deckDecision('a', payload(), new Map(), NOW, new Map([['a', NOW - DECK_DECIDE_WINDOW_MS]]))).toBe('ok');
  });
  it('forgets presses once the minute is up', () => {
    const pressed = new Map([['a', NOW - DECK_DECIDE_WINDOW_MS], ['b', NOW - 1000], ['c', NOW + 5000]]);
    prunePresses(pressed, NOW);
    expect([...pressed.keys()]).toEqual(['b']);
  });
});

describe('opening the app from a key', () => {
  it('shows the app, or takes it to a thingglance:// link, and nothing else', () => {
    expect(deckOpenLink(null)).toBeNull();
    expect(deckOpenLink('thingglance://queue')).toBe('thingglance://queue');
    expect(deckOpenLink('https://example.com/')).toBe(false);
    expect(deckOpenLink('settings')).toBe(false);
  });
});

describe('what the listener accepts', () => {
  const frame = (o: unknown) => JSON.stringify(o);
  it('a press, an open and a token, each with the fields it needs', () => {
    expect(parseDeckCommand(frame({ type: 'tg:event:decide', key: 'coverage-end:6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b:2026-11-25', clientId: 'k1' })))
      .toEqual({ type: 'tg:event:decide', key: 'coverage-end:6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b:2026-11-25', clientId: 'k1' });
    expect(parseDeckCommand(frame({ type: 'tg:open', target: 'thingglance://queue', clientId: 'k2' }))).toEqual({ type: 'tg:open', target: 'thingglance://queue', clientId: 'k2' });
    expect(parseDeckCommand(frame({ type: 'tg:open', clientId: 'k3' }))).toEqual({ type: 'tg:open', target: null, clientId: 'k3' });
    expect(parseDeckCommand(frame({ type: 'tg:auth', token: 'a'.repeat(32) }))).toEqual({ type: 'tg:auth', token: 'a'.repeat(32) });
    expect(parseDeckCommand(new TextEncoder().encode(frame({ type: 'tg:open', clientId: 'k4' })))).toMatchObject({ type: 'tg:open' });
  });
  it.each([
    ['not JSON', '{oops'],
    ['another app\'s message', frame({ type: 'lg:chore:complete', choreId: 'c1', clientId: 'k1' })],
    ['a press with no id of its own', frame({ type: 'tg:event:decide', key: 'a' })],
    ['a key with a space in it', frame({ type: 'tg:event:decide', key: 'a b', clientId: 'k1' })],
    ['a token of the wrong shape', frame({ type: 'tg:auth', token: 'short' })],
    ['an array', '[1,2]'],
    ['a frame that is too large', frame({ type: 'tg:open', clientId: 'k1', pad: 'x'.repeat(MAX_FRAME_BYTES) })],
  ])('and refuses %s', (_what, raw) => { expect(parseDeckCommand(raw)).toBeNull(); });
});
