// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import WebSocket from 'ws';
import { createConnection, type SocketLike } from './connection';
import { queueKey, waitingKey } from './keys';
import { startStreamDeckServer, type StreamDeckServer } from '../../electron/streamDeckServer';
import { deckDecision, deckOpenLink, deckState } from '../../electron/deckModel';
import { parseTrayPayload } from '../../electron/trayModel';

// The two halves together: the plugin's real connection against the app's
// real listener and deck model, over a real socket. The protocol module is
// shared, but only this shows the plugin is let in, gets the state the keys
// draw, and has its press reach the app and come back answered.

const day = (offset: number) => { const d = new Date(Date.now() + offset * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const event = (key: string, offset: number) => ({ key, type: 'coverage-end', date: day(offset), days: offset, severity: 'soon', title: 'Warranty ends', detail: `Thing ${key}`, state: 'open', link: `thingglance://event/${key}` });
const payload = parseTrayPayload(JSON.stringify({
  snapshot: {
    generatedAt: new Date().toISOString(), currency: 'USD', locale: 'en-US', counts: { attention: 2 },
    attention: [event('a', 9), event('b', 22)], upcoming: [], things: [], charges: { days: 30, total: 0, count: 0 }, reminders: [],
  },
  labels: { verdicts: {} }, canSend: false,
}))!;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as net.AddressInfo; probe.close(() => resolve(port)); });
  });
}

let server: StreamDeckServer | null = null;
afterEach(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); server = null; });

describe('the plugin and the app together', () => {
  it('connects, draws the app\'s queue, and a press comes back answered once', async () => {
    const port = await freePort();
    const decided = new Map<string, number>();
    const opened: (string | null)[] = [];
    const onCommand = vi.fn((cmd: { type: string; key?: string; target?: string | null }) => {
      if (cmd.type === 'tg:event:decide') {
        const verdict = deckDecision(cmd.key!, payload, decided, Date.now());
        if (verdict !== 'ok') return { ok: false as const, reason: verdict };
        decided.set(cmd.key!, Date.now());
        server!.broadcast();
        return { ok: true as const };
      }
      const link = deckOpenLink(cmd.target ?? null);
      if (link === false) return { ok: false as const, reason: 'refused' as const };
      opened.push(link);
      return { ok: true as const };
    });
    server = startStreamDeckServer({ port, getState: () => deckState(payload, { decided, sent: new Map() }, Date.now()), onCommand });
    await new Promise<void>((r) => server!.wss.once('listening', () => r()));

    const conn = createConnection({ url: `ws://127.0.0.1:${port}`, open: (url) => new WebSocket(url) as unknown as SocketLike });
    conn.start();
    await vi.waitFor(() => expect(conn.state()?.ready).toBe(true));

    expect(queueKey(conn.state(), 0)).toMatchObject({ count: 2, event: { key: 'a' }, view: { title: 'T-9d', sub: 'Thing a', badge: '1/2' } });
    expect(waitingKey(conn.state()).title).toBe('2');

    await expect(conn.decide('a')).resolves.toEqual({ ok: true });
    // The app hides it at once, and tells the keys.
    await vi.waitFor(() => expect(queueKey(conn.state(), 0)).toMatchObject({ count: 1, event: { key: 'b' } }));
    expect(waitingKey(conn.state()).title).toBe('1');
    await expect(conn.decide('a')).resolves.toEqual({ ok: false, reason: 'too_soon' });
    await expect(conn.decide('never-listed')).resolves.toEqual({ ok: false, reason: 'unknown_event' });

    await expect(conn.openApp('thingglance://queue')).resolves.toEqual({ ok: true });
    await expect(conn.openApp(null)).resolves.toEqual({ ok: true });
    await expect(conn.openApp('https://example.com/')).resolves.toEqual({ ok: false, reason: 'refused' });
    expect(opened).toEqual(['thingglance://queue', null]);

    // The app going away reads as not running on every key.
    server.close();
    server = null;
    await vi.waitFor(() => expect(conn.state()).toBeNull());
    conn.stop();
  });
});
