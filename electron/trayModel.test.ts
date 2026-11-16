import { describe, expect, it } from 'vitest';
import { BLUR_CLICK_WINDOW_MS, DECIDED_HERE_MS, isClickAfterBlurHide, parseTrayPayload, popupPosition, settledHere, trayEvent, trayMenuItems, trayState } from './trayModel';

const AT = '2026-11-16T16:00:00.000Z';
const T = Date.parse(AT);
const event = (key: string, state = 'open') => ({ key, type: 'coverage-end', date: '2026-11-25', days: 9, severity: 'soon', title: `Warranty ends`, detail: `Thing ${key}`, state, link: `thingglance://event/${key}`, handlerId: null });
const payloadJson = (over: Record<string, unknown> = {}, attention = [event('a'), event('b'), event('c')]) => JSON.stringify({
  snapshot: {
    version: 1, generatedAt: AT, day: '2026-11-16', currency: 'USD', locale: 'en-US',
    counts: { things: 4, subscriptions: 2, attention: attention.length, urgent: 0, covered: 2 },
    attention, upcoming: [event('a'), event('z')], things: [], charges: { days: 30, total: 0, count: 0, items: [], months: [] },
    reminders: [{ id: 'a@last-call', eventKey: 'a', at: T + 1000, title: 't', body: 'b', link: 'thingglance://event/a' }],
  },
  labels: { done: 'Done with this', send: 'Send to dayGLANCE', decideTitle: 'Needs a decision' },
  canSend: true,
  launcher: { attention: [], upcoming: [], charges: [], handledWrites: [], syncedAt: null },
  ...over,
});
const none = { decided: new Map<string, number>(), sent: new Map<string, number>() };

describe('the payload the main window pushes', () => {
  it('is kept as sent, less the launcher\'s share, with what the tray and the scheduler need pulled out', () => {
    const p = parseTrayPayload(payloadJson())!;
    expect(p.generatedAt).toBe(T);
    expect(p.attention.map((e) => e.key)).toEqual(['a', 'b', 'c']);
    expect(p.reminders).toHaveLength(1);
    expect(p.words).toEqual({ done: 'Done with this', send: 'Send to dayGLANCE', canSend: true });
    expect(p.payload).not.toHaveProperty('launcher');
    expect((p.payload.snapshot.counts as { things: number }).things).toBe(4);
  });

  it.each([['not JSON', '{oops'], ['not a payload', '{"hello":1}'], ['no snapshot time', JSON.stringify({ snapshot: { attention: [], upcoming: [] } })], ['not a string', 42]])(
    'refuses %s', (_what, value) => { expect(parseTrayPayload(value)).toBeNull(); });

  it('skips a date it cannot name or open, and keeps the rest', () => {
    const p = parseTrayPayload(payloadJson({}, [event('a'), { key: 'broken' } as never, event('c')]))!;
    expect(p.attention.map((e) => e.key)).toEqual(['a', 'c']);
  });

  it('offers Send only when the page says dayGLANCE can be reached', () => {
    expect(parseTrayPayload(payloadJson({ canSend: false }))!.words.canSend).toBe(false);
  });
});

describe('what the tray shows', () => {
  it('is not ready until a snapshot has arrived', () => {
    expect(trayState(null, none)).toEqual({ ready: false, waiting: 0, attention: [], payload: null });
  });

  it('hides a date ticked here at once, in the list, the count and the menu', () => {
    const p = parseTrayPayload(payloadJson())!;
    const s = trayState(p, { decided: new Map([['b', T]]), sent: new Map() });
    expect(s.waiting).toBe(2);
    expect(s.attention.map((e) => e.key)).toEqual(['a', 'c']);
    const snapshot = s.payload!.snapshot as { attention: { key: string }[]; counts: { attention: number } };
    expect(snapshot.attention.map((e) => e.key)).toEqual(['a', 'c']);
    expect(snapshot.counts.attention).toBe(2);
  });

  it('marks a ticked date done where it still shows among what is coming up', () => {
    const p = parseTrayPayload(payloadJson())!;
    const s = trayState(p, { decided: new Map([['a', T]]), sent: new Map() });
    expect((s.payload!.snapshot as { upcoming: { key: string; state: string }[] }).upcoming.map((e) => `${e.key}:${e.state}`)).toEqual(['a:done', 'z:open']);
  });

  it('marks a date handed to dayGLANCE here as sent, and leaves it listed', () => {
    const p = parseTrayPayload(payloadJson())!;
    const s = trayState(p, { decided: new Map(), sent: new Map([['c', T]]) });
    expect(s.waiting).toBe(3);
    expect((s.payload!.snapshot as { attention: { key: string; state: string }[] }).attention.map((e) => e.state)).toEqual(['open', 'open', 'sent']);
    expect(s.attention[2].state).toBe('sent');
  });

  it('counts from the snapshot\'s total, which can be more than the rows it carries', () => {
    const json = JSON.parse(payloadJson());
    json.snapshot.counts.attention = 20;
    const s = trayState(parseTrayPayload(JSON.stringify(json))!, { decided: new Map([['a', T]]), sent: new Map() });
    expect(s.waiting).toBe(19);
  });

  it('does not touch the payload it was given', () => {
    const p = parseTrayPayload(payloadJson())!;
    trayState(p, { decided: new Map([['a', T]]), sent: new Map([['b', T]]) });
    expect((p.payload.snapshot.attention as { key: string; state: string }[]).map((e) => `${e.key}:${e.state}`)).toEqual(['a:open', 'b:open', 'c:open']);
  });
});

describe('when a tick made here stops being hidden', () => {
  const p = (attention: ReturnType<typeof event>[], at = AT) => parseTrayPayload(payloadJson({}, attention).replace(AT, at))!;

  it('once a snapshot made after it no longer lists the date', () => {
    expect(settledHere(new Map([['b', T - 1000]]), p([event('a'), event('c')]), 'decided', T)).toEqual(['b']);
  });

  it('not on a snapshot made before it, even one without the date', () => {
    expect(settledHere(new Map([['b', T + 1000]]), p([event('a')]), 'decided', T + 2000)).toEqual([]);
  });

  it('not while the page has yet to apply it', () => {
    expect(settledHere(new Map([['b', T - 1000]]), p([event('a'), event('b')]), 'decided', T)).toEqual([]);
  });

  it('after a minute whatever the snapshot says, so a refused write shows the date again', () => {
    expect(settledHere(new Map([['b', T - DECIDED_HERE_MS - 1]]), p([event('b')]), 'decided', T)).toEqual(['b']);
  });

  it('for a send, once the snapshot shows the date handed over', () => {
    expect(settledHere(new Map([['b', T - 1000]]), p([event('b', 'sent')]), 'sent', T)).toEqual(['b']);
    expect(settledHere(new Map([['b', T - 1000]]), p([event('b', 'open')]), 'sent', T)).toEqual([]);
  });
});

describe('acting from the tray', () => {
  it('only on a date the tray shows', () => {
    const p = parseTrayPayload(payloadJson())!;
    expect(trayEvent(p, 'a')?.link).toBe('thingglance://event/a');
    expect(trayEvent(p, 'nope')).toBeNull();
    expect(trayEvent(p, 42)).toBeNull();
    expect(trayEvent(null, 'a')).toBeNull();
  });
});

describe('the menu', () => {
  const labels = { open: 'Open thingGLANCE', quit: 'Quit thingGLANCE', done: 'Done with this', nothingWaiting: 'Nothing waiting' };

  it('on Linux lists the dates waiting, each with Done and Open', () => {
    const items = trayMenuItems(trayState(parseTrayPayload(payloadJson())!, none), labels, true);
    expect(items.map((i) => i.kind)).toEqual(['open', 'separator', 'event', 'event', 'event', 'separator', 'quit']);
    expect(items[2]).toMatchObject({ label: 'Warranty ends · Thing a', key: 'a', done: 'Done with this' });
  });

  it('says so when nothing is waiting', () => {
    const items = trayMenuItems(trayState(parseTrayPayload(payloadJson({}, []))!, none), labels, true);
    expect(items[2]).toEqual({ kind: 'empty', label: 'Nothing waiting' });
  });

  it('elsewhere is Open and Quit only: the popup has the dates', () => {
    expect(trayMenuItems(trayState(parseTrayPayload(payloadJson())!, none), labels, false).map((i) => i.kind)).toEqual(['open', 'separator', 'quit']);
  });
});

describe('the popup', () => {
  const size = { width: 380, height: 560 };
  const screen = { x: 0, y: 0, width: 1920, height: 1080 };

  it('drops below a menu bar icon and rises above a taskbar one', () => {
    expect(popupPosition({ x: 1500, y: 0, width: 24, height: 24 }, size, screen)).toEqual({ x: 1322, y: 30 });
    expect(popupPosition({ x: 1500, y: 1050, width: 24, height: 24 }, size, screen).y).toBe(1050 - 560 - 6);
  });

  it('stays on the screen', () => {
    expect(popupPosition({ x: 1900, y: 0, width: 24, height: 24 }, size, screen).x).toBe(1920 - 380 - 6);
    expect(popupPosition({ x: 0, y: 0, width: 24, height: 24 }, size, screen).x).toBe(6);
  });

  it('is not reopened by the click that closed it (Windows)', () => {
    expect(isClickAfterBlurHide(1000, 1000 - BLUR_CLICK_WINDOW_MS + 1)).toBe(true);
    expect(isClickAfterBlurHide(1000, 1000 - BLUR_CLICK_WINDOW_MS)).toBe(false);
    expect(isClickAfterBlurHide(1000, null)).toBe(false);
  });
});
