import { describe, expect, it } from 'vitest';
import type { DeckEvent, DeckState, DeckThing } from '../../electron/deckProtocol';
import { CATEGORIES } from '../../src/core/categories';
import { CATEGORY_ICON, EVENT_ICON } from './keyIcons';
import { AMBER, GREEN, GREY, NOT_READY, OFFLINE, RED, SKY, addKey, chargesKey, comingUpKey, fit, money, pickThing, queueKey, severityColor, tMinus, thingKey, verdictColor, waitingKey } from './keys';
import table from './generated/icons.json';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const event = (key: string, days: number, over: Partial<DeckEvent> = {}): DeckEvent =>
  ({ key, type: 'coverage-end', title: 'Warranty ends', detail: `Thing ${key}`, date: '2026-11-25', days, severity: 'soon', state: 'open', amount: null, link: `thingglance://event/${key}`, ...over });
const thing = (id: string, over: Partial<DeckThing> = {}): DeckThing =>
  ({ id, name: `Thing ${id}`, category: 'phone', verdict: 'solid', verdictLabel: 'Solid', lifeEnd: '2028-01-01', daysLeft: 400, remaining: 0.6, link: `thingglance://thing/${id}`, ...over });
const state = (over: Partial<DeckState> = {}): DeckState => ({
  v: 1, type: 'tg:state', at: '2026-11-16T12:00:00.000Z', ready: true, waiting: 2,
  queue: [event('a', 3, { severity: 'urgent' }), event('b', 22)], upcoming: [event('z', 77, { type: 'renewal', severity: 'later', detail: 'Cloud 2 TB' })],
  things: [thing('t1'), thing('t2', { name: 'TV', category: 'tv', verdict: 'replace', verdictLabel: 'Plan its replacement', daysLeft: 55, remaining: 0.05 }), thing('t3', { daysLeft: null, lifeEnd: null, remaining: null, verdict: 'unknown', verdictLabel: 'No dates yet' })],
  charges: { days: 30, total: 134.99, count: 2 }, currency: 'USD', locale: 'en-US', ...over,
});

describe('the app\'s own notation and icons', () => {
  it('counts down as the app does', () => {
    expect([tMinus(0), tMinus(12), tMinus(-3), tMinus(59), tMinus(60), tMinus(365), tMinus(730), tMinus(1100)])
      .toEqual(['T-0', 'T-12d', 'T+3d', 'T-59d', 'T-2mo', 'T-12mo', 'T-2y', 'T-3y']);
  });

  it('draws each category with the icon the app gives it', () => {
    expect(CATEGORY_ICON).toEqual(Object.fromEntries(CATEGORIES.map((c) => [c.id, c.icon])));
  });

  it('draws each kind of date with the icon the app gives it', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/components/icons.tsx'), 'utf-8');
    for (const [type, icon] of Object.entries(EVENT_ICON)) expect(source, type).toMatch(new RegExp(`'?${type}'?: ${icon},`));
  });

  it('has the markup for every icon a key can ask for', () => {
    const names = [...Object.values(EVENT_ICON), ...Object.values(CATEGORY_ICON), OFFLINE.icon!, NOT_READY.icon!, addKey(state()).icon!, 'CircleCheck', 'CalendarClock'];
    for (const n of names) expect((table as { icons: Record<string, string> }).icons[n], n).toBeTruthy();
  });

  it('colours a date by how pressing it is, and a thing by its verdict', () => {
    expect([severityColor('past'), severityColor('urgent'), severityColor('soon'), severityColor('later')]).toEqual([RED, RED, AMBER, SKY]);
    expect([verdictColor('prime'), verdictColor('watch'), verdictColor('overdue'), verdictColor('unknown')]).toEqual([GREEN, AMBER, RED, GREY]);
  });

  it('writes money in the app\'s currency and language, and survives tags it cannot use', () => {
    expect(money(134.99, 'USD', 'en-US')).toBe('$135');
    expect(money(9.5, 'USD', 'en-US')).toBe('$9.50');
    expect(money(12.5, 'not-a-currency', 'en-US')).toBe('12.5');
  });

  it('trims long text with an ellipsis', () => {
    expect(fit('Living room television', 12)).toBe('Living room…');
    expect(fit('TV', 12)).toBe('TV');
  });
});

describe('when the app is not there', () => {
  it('every key says so, and never "nothing waiting"', () => {
    for (const view of [queueKey(null, 0).view, comingUpKey(null, 0).view, waitingKey(null), chargesKey(null), thingKey(null, null).view, addKey(null)]) expect(view).toEqual(OFFLINE);
    const idle = state({ ready: false, queue: [], upcoming: [], things: [], waiting: 0 });
    for (const view of [queueKey(idle, 0).view, comingUpKey(idle, 0).view, waitingKey(idle), chargesKey(idle), thingKey(idle, null).view]) expect(view).toEqual(NOT_READY);
  });
});

describe('the Queue key', () => {
  it('shows one date at a time, with its countdown and where it is in the queue', () => {
    const k = queueKey(state(), 0);
    expect(k).toMatchObject({ index: 0, count: 2, event: { key: 'a' }, view: { title: 'T-3d', sub: 'Thing a', icon: 'ShieldCheck', accent: RED, big: true, badge: '1/2' } });
    expect(queueKey(state(), 1).view).toMatchObject({ title: 'T-22d', accent: AMBER, badge: '2/2' });
  });
  it('wraps round both ways, and follows a queue that got shorter', () => {
    expect(queueKey(state(), 2).index).toBe(0);
    expect(queueKey(state(), -1).index).toBe(1);
    expect(queueKey(state({ queue: [event('b', 22)] }), 1)).toMatchObject({ index: 0, event: { key: 'b' } });
  });
  it('says all clear with nothing waiting, and has nothing to act on', () => {
    expect(queueKey(state({ queue: [], waiting: 0 }), 0)).toMatchObject({ event: null, view: { title: 'All clear', accent: GREEN } });
  });
  it('shows a date handed to dayGLANCE in the app\'s blue', () => {
    expect(queueKey(state({ queue: [event('a', 3, { state: 'sent', severity: 'urgent' })] }), 0).view.accent).toBe(SKY);
  });
});

describe('the other keys', () => {
  it('Waiting counts, red when something is urgent', () => {
    expect(waitingKey(state())).toMatchObject({ title: '2', sub: 'waiting', accent: RED, big: true });
    expect(waitingKey(state({ queue: [event('b', 22)], waiting: 1 }))).toMatchObject({ title: '1', accent: AMBER });
    expect(waitingKey(state({ queue: [], waiting: 0 }))).toMatchObject({ title: '0', sub: 'All clear', accent: GREEN });
  });
  it('Coming up shows what is ahead, and says so when nothing is', () => {
    expect(comingUpKey(state(), 0)).toMatchObject({ event: { key: 'z' }, view: { title: 'T-3mo', sub: 'Cloud 2 TB', icon: 'Repeat', accent: SKY } });
    expect(comingUpKey(state({ upcoming: [] }), 0)).toMatchObject({ event: null, view: { dim: true } });
  });
  it('Charges totals the days ahead', () => {
    expect(chargesKey(state())).toMatchObject({ title: '$135', sub: 'next 30d · 2' });
    expect(chargesKey(state({ charges: { days: 30, total: 0, count: 0 } }))).toMatchObject({ dim: true });
  });
  it('Thing shows the chosen thing, with its category\'s icon and its window left', () => {
    expect(thingKey(state(), 't2')).toMatchObject({ thing: { id: 't2' }, view: { title: 'TV', sub: 'T-55d · Plan its replacement', icon: 'Tv', accent: RED, ratio: 0.05 } });
    expect(thingKey(state(), 't3').view).toMatchObject({ sub: 'No dates yet', accent: GREY });
  });
  it('Thing with none chosen shows what is closest to the end of its window', () => {
    expect(pickThing(state(), null)?.id).toBe('t2');
    expect(thingKey(state(), 'gone')).toMatchObject({ thing: null, view: { sub: 'No longer tracked', dim: true } });
    expect(thingKey(state({ things: [] }), null)).toMatchObject({ thing: null, view: { sub: 'No things yet' } });
  });
});
