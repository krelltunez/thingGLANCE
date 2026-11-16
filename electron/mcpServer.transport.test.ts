// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import net from 'node:net';
import type http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createIdempotencyStore, createWriteGate, generateMcpToken, type BridgeResult, type HostBridge } from '@glance-apps/mcp-host';
import { MCP_ENDPOINT_PATH, startMcpServer } from './mcpServer.js';
import { UNAVAILABLE, WRITE_TIMEOUT_MS } from './mcpRendererBridge.js';
import { createJournal } from './mcpJournal.js';
import { household, readOf, writeDepsOf, NOW, type Household } from '../src/mcp/fixture';
import { handleRead } from '../src/mcp/readModel';
import { handleWrite } from '../src/mcp/writeModel';

// The seam no unit test sees (after lastGLANCE's and dayGLANCE's suites of the
// same name): the real listener on a free loopback port, the official MCP
// client over real HTTP with the real bearer token, the real tools, and a
// bridge that answers through the page's real read and write models over a
// household in memory. It pins the wiring: that the names are the ones
// docs/mcp.md documents, that a call reaches the page as the method the model
// answers, that a failure comes back typed and never as an empty result, that
// the write pipeline (consent, replay, journal) runs, and that the guards in
// front run on the real request path.

const TOKEN = generateMcpToken();
const TZ = 'UTC';

const reference = readFileSync(path.resolve(__dirname, '../docs/mcp.md'), 'utf-8');
const documentedTools = [...reference.matchAll(/^### `(thingglance_[a-z_]+)`/gm)].map((m) => m[1]);
const documentedResources = [...reference.matchAll(/^\| `(thingglance:\/\/[a-z/-]+)` \|/gm)].map((m) => m[1]);

type Call = { method: string; params: unknown; timeoutMs: number | undefined };

/** A bridge answered by the page's models over `h`, recording every request; `answer` overrides it. */
function modelBridge(h: Household = household(), answer?: (method: string) => BridgeResult | undefined) {
  const calls: Call[] = [];
  const { deps } = writeDepsOf(h);
  const bridge: HostBridge = {
    async request(method, params = {}, timeoutMs) {
      calls.push({ method, params, timeoutMs });
      const over = answer?.(method);
      if (over) return over;
      const p = params as Record<string, unknown>;
      return (handleRead(readOf(h), method, p) ?? await handleWrite(method, p, deps) ?? { ok: false, error: { code: 'unknown_method', message: method } }) as BridgeResult;
    },
    async ping() { return true; },
    dispose() {},
  };
  return { bridge, calls, h };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Harness {
  url: string;
  journal: ReturnType<typeof createJournal>;
  connect(token?: string): Promise<Client>;
  close(): Promise<void>;
}

const open: Harness[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map((h) => h.close())); });

async function start(bridge: HostBridge, opts: { writes?: boolean; token?: string | (() => string) } = {}): Promise<Harness> {
  const port = await freePort();
  const quiet = () => {};
  const journal = createJournal();
  const server: http.Server | null = startMcpServer({
    token: opts.token ?? TOKEN,
    portOverride: port,
    readDeps: { bridge, now: () => NOW, timeZone: () => TZ },
    writeDeps: { bridge, gate: createWriteGate(), store: createIdempotencyStore(), token: () => TOKEN, includeWrites: () => opts.writes ?? true, onWritesDisabled: () => {}, journal },
    log: quiet,
    logError: quiet,
  });
  if (!server) throw new Error('the listener refused to start');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`;
  const clients: Client[] = [];
  const h: Harness = {
    url,
    journal,
    async connect(t = TOKEN) {
      const client = new Client({ name: 'thingglance-transport-test', version: '0.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
  open.push(h);
  return h;
}

type Row = { [key: string]: unknown };
type ToolResult = { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Row };
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) =>
  await client.callTool({ name, arguments: args }) as ToolResult;
const body = (r: ToolResult) => JSON.parse(r.content[0].text);

describe('the registered surface', () => {
  it('serves exactly the documented tools and resources, each with a description', async () => {
    expect(documentedTools.length).toBeGreaterThan(10);
    const client = await (await start(modelBridge().bridge)).connect();
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...documentedTools].sort());
    expect((await client.listResources()).resources.map((r) => r.uri).sort()).toEqual([...documentedResources].sort());
    for (const t of tools) expect(t.description, t.name).toBeTruthy();
  });

  it('has no tool that deletes', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    expect((await client.listTools()).tools.map((t) => t.name).filter((n) => /delete|remove|wipe/.test(n))).toEqual([]);
  });
});

describe('reading', () => {
  it('answers the overview from the page, with today and the zone', async () => {
    const m = modelBridge();
    const client = await (await start(m.bridge)).connect();
    const r = await call(client, 'thingglance_get_overview');
    expect(r.isError).toBeFalsy();
    expect(body(r)).toMatchObject({ date: '2026-11-16', timezone: 'UTC', currency: 'USD', counts: { things_in_service: 3 } });
    expect(m.calls.map((c) => c.method)).toEqual(['overview']);
  });

  it('paginates a list, with a cursor bound to its filters', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    const first = body(await call(client, 'thingglance_list_things', { limit: 2 }));
    expect(first).toMatchObject({ truncated: true, total: 3 });
    expect(first.items).toHaveLength(2);
    const second = body(await call(client, 'thingglance_list_things', { limit: 2, cursor: first.next_cursor }));
    expect(second.items).toHaveLength(1);
    expect(second.truncated).toBe(false);
    const moved = await call(client, 'thingglance_list_things', { limit: 2, cursor: first.next_cursor, status: 'all' });
    expect(moved.isError).toBe(true);
    expect(body(moved).error.code).toBe('validation');
  });

  it('reaches one thing, the plans, the dates ahead, the queue and the household', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    expect(body(await call(client, 'thingglance_get_thing', { thing_id: 't-phone' })).thing.name).toBe('Pixel 9');
    expect(body(await call(client, 'thingglance_list_plans')).totals.currency).toBe('USD');
    expect(body(await call(client, 'thingglance_list_upcoming', { types: ['coverage-end'] })).items.length).toBeGreaterThan(0);
    expect(body(await call(client, 'thingglance_list_queue')).total).toBeGreaterThan(0);
    expect(body(await call(client, 'thingglance_list_members')).this_device_member_id).toBe('ann');
    expect(body(await call(client, 'thingglance_ping')).ok).toBe(true);
  });

  it('reports a typed error, never an empty answer', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    const missing = await call(client, 'thingglance_get_thing', { thing_id: 'nope' });
    expect(missing.isError).toBe(true);
    expect(body(missing).error.code).toBe('not_found');
    const bad = await call(client, 'thingglance_list_upcoming', { from: 'tomorrow' });
    expect(body(bad).error.code).toBe('validation');
  });

  it('says so when the window is not there, and that this is not an empty list', async () => {
    const client = await (await start(modelBridge(household(), () => UNAVAILABLE).bridge)).connect();
    const r = await call(client, 'thingglance_list_things');
    expect(r.isError).toBe(true);
    expect(body(r).error.code).toBe('renderer_unavailable');
    expect(body(r).error.message).toContain('NOT an empty list');
  });

  it('serves the queue as a resource', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    const res = await client.readResource({ uri: 'thingglance://queue' });
    const text = (res.contents[0] as { text: string }).text;
    expect(JSON.parse(text)).toMatchObject({ date: '2026-11-16', counts: { things_in_service: 3 } });
  });
});

describe('changing', () => {
  it('is refused while "Allow changes" is off, before anything reaches the page', async () => {
    const m = modelBridge();
    const client = await (await start(m.bridge, { writes: false })).connect();
    const r = await call(client, 'thingglance_create_thing', { name: 'Kindle' });
    expect(r.isError).toBe(true);
    expect(body(r).error.code).toBe('read_only_mode');
    expect(m.calls).toEqual([]);
  });

  it('adds a thing through the page, journals the undo, and keeps it out of the answer', async () => {
    const m = modelBridge();
    const h = await start(m.bridge);
    const client = await h.connect();
    const r = await call(client, 'thingglance_create_thing', { name: 'Kindle', price: 129, idempotency_key: 'kindle-1' });
    expect(r.isError).toBeFalsy();
    expect(body(r)).toMatchObject({ created: true, thing: { name: 'Kindle', price: 129 } });
    expect(JSON.stringify(body(r))).not.toContain('remove_created_thing');
    expect(m.h.things.some((t) => t.name === 'Kindle')).toBe(true);
    expect(m.calls[0]).toMatchObject({ method: 'create_thing', timeoutMs: WRITE_TIMEOUT_MS });
    expect(h.journal.entries().map((e) => [e.tool, e.op.kind])).toEqual([['thingglance_create_thing', 'remove_created_thing']]);
    const listed = body(await call(client, 'thingglance_list_mcp_writes'));
    expect(listed.total).toBe(1);
    expect(listed.items[0].summary).toBe('Added "Kindle"');
  });

  it('replays a repeated key without touching the page again', async () => {
    const m = modelBridge();
    const h = await start(m.bridge);
    const client = await h.connect();
    const first = body(await call(client, 'thingglance_create_thing', { name: 'Kindle', idempotency_key: 'kindle-1' }));
    const again = body(await call(client, 'thingglance_create_thing', { name: 'Kindle', idempotency_key: 'kindle-1' }));
    expect(again.replayed).toBe(true);
    expect(again.thing.thing_id).toBe(first.thing.thing_id);
    expect(m.calls.filter((c) => c.method === 'create_thing')).toHaveLength(1);
    expect(m.h.things.filter((t) => t.name === 'Kindle')).toHaveLength(1);
    expect(h.journal.entries()).toHaveLength(1);
  });

  it('edits, reassigns, covers, plans and settles, each landing in the household', async () => {
    const m = modelBridge();
    const client = await (await start(m.bridge)).connect();
    expect(body(await call(client, 'thingglance_update_thing', { thing_id: 't-laptop', price: 2200 })).changed).toEqual(['price']);
    expect(body(await call(client, 'thingglance_reassign_thing', { thing_id: 't-laptop', owner_member_id: 'kid' })).thing.owner_name).toBe('Kit');
    expect(body(await call(client, 'thingglance_add_coverage', { thing_id: 't-tv', name: 'Store warranty', end_date: '2027-01-10' })).created).toBe(true);
    expect(body(await call(client, 'thingglance_create_plan', { name: 'Music', amount: 10.99 })).plan.name).toBe('Music');
    expect(body(await call(client, 'thingglance_update_plan', { plan_id: 'p-stream', status: 'cancelled', end_date: '2026-12-03' })).plan.status).toBe('cancelled');
    const key = body(await call(client, 'thingglance_list_queue')).items[0].event_key;
    expect(body(await call(client, 'thingglance_decide_event', { event_key: key })).state).toBe('done');
    expect(m.h.things.find((t) => t.id === 't-laptop')).toMatchObject({ price: 2200, ownerMemberId: 'kid' });
    expect(m.h.decisions).toHaveLength(1);
  });

  it('passes the page\'s refusal on, typed', async () => {
    const client = await (await start(modelBridge().bridge)).connect();
    const r = await call(client, 'thingglance_update_thing', { thing_id: 't-tv', visibility: 'private' });
    expect(r.isError).toBe(true);
    expect(body(r).error.code).toBe('validation');
    const key = await call(client, 'thingglance_create_thing', { name: 'Kindle', idempotency_key: 'not a key!' });
    expect(body(key).error.code).toBe('validation');
  });
});

describe('the guards in front', () => {
  it('refuses a request without the token, and one with the wrong one', async () => {
    const h = await start(modelBridge().bridge);
    const none = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(none.status).toBe(401);
    await expect(h.connect('f'.repeat(64))).rejects.toThrow();
  });

  it('reads the token on every request, so a new one applies at once', async () => {
    let token = TOKEN;
    const h = await start(modelBridge().bridge, { token: () => token });
    const client = await h.connect();
    expect(body(await call(client, 'thingglance_ping')).ok).toBe(true);
    token = generateMcpToken();
    await expect(call(client, 'thingglance_ping')).rejects.toThrow();
  });

  it('answers on its own path only', async () => {
    const h = await start(modelBridge().bridge);
    const res = await fetch(h.url.replace('/mcp', '/other'), { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{}' });
    expect(res.status).toBe(404);
  });
});
