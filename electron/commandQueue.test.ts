import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMAND_LIMIT, createCommandQueue } from './commandQueue';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function queue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thingglance-commands-'));
  dirs.push(dir);
  let n = 0;
  const file = path.join(dir, 'commands.json');
  return { file, q: createCommandQueue({ file, newId: () => `id-${++n}`, now: () => Date.parse('2026-11-10T12:00:00Z') }) };
}

describe('the command queue', () => {
  it('keeps a command until it is acknowledged, across a restart', () => {
    const { file, q } = queue();
    const c = q.enqueue('decide', { event_key: 'k1', state: 'done' }, 'tray');
    expect(c).toEqual({ clientId: 'id-1', action: 'decide', payload: { event_key: 'k1', state: 'done' }, source: 'tray', at: '2026-11-10T12:00:00.000Z' });
    expect(q.take()).toEqual([c]);
    expect(q.take()).toEqual([c]);                           // taking does not remove
    const again = createCommandQueue({ file, newId: () => 'x' });
    expect(again.take()).toEqual([c]);                        // a crash before the ack replays it
    again.ack(['id-1']);
    expect(q.take()).toEqual([]);
  });

  it('refuses actions outside the vocabulary, and ignores a bad ack', () => {
    const { q } = queue();
    expect(q.enqueue('delete_everything', {}, 'tray')).toBeNull();
    q.enqueue('send', { event_key: 'k1' }, 'notification');
    q.ack('id-1');
    q.ack([42, 'nope']);
    expect(q.take()).toHaveLength(1);
  });

  it('acknowledges by id, leaving the rest in order', () => {
    const { q } = queue();
    q.enqueue('decide', { event_key: 'a', state: 'done' }, 'tray');
    q.enqueue('decide', { event_key: 'b', state: 'done' }, 'tray');
    q.enqueue('decide', { event_key: 'c', state: 'done' }, 'tray');
    q.ack(['id-2']);
    expect(q.take().map((c) => c.payload.event_key)).toEqual(['a', 'c']);
  });

  it('is bounded, dropping the oldest', () => {
    const { q } = queue();
    for (let i = 0; i < COMMAND_LIMIT + 5; i++) q.enqueue('decide', { event_key: `c${i}`, state: 'done' }, 'tray');
    const all = q.take();
    expect(all).toHaveLength(COMMAND_LIMIT);
    expect(all[0].payload.event_key).toBe('c5');
  });

  it('reads a corrupt or foreign file as empty, and drops malformed entries', () => {
    const { file, q } = queue();
    fs.writeFileSync(file, '{oops');
    expect(q.take()).toEqual([]);
    fs.writeFileSync(file, JSON.stringify([
      { clientId: 'ok', action: 'decide', payload: {}, source: 'tray', at: 'x' },
      { clientId: 'deck', action: 'decide', payload: {}, source: 'streamdeck', at: 'x' },
      { clientId: 'stranger', action: 'decide', payload: {}, source: 'webpage', at: 'x' },
      { clientId: 'bad' }, null,
    ]));
    expect(q.take().map((c) => c.clientId)).toEqual(['ok', 'deck']);
  });
});
