// thingGLANCE's MCP read tools and resources (docs/mcp.md is the contract,
// and the transport suite holds the tool names to it). After lastGLANCE's
// electron/mcpReadTools.ts.
//
// No state here: everything arrives in `deps`, owned by main.ts and closed
// over by the per-request server factory (mcpServer.ts). The tools validate
// and paginate; the page's read model (src/mcp/readModel.ts) filters and
// shapes, over the request bridge, as the member this device belongs to.
//
// Errors are tool errors (isError) with a JSON body {error: {code, message}}
// the model can branch on: renderer_unavailable, not_found, validation,
// internal. An unavailable window is never an empty result.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, paginate, type BridgeResult, type HostBridge } from '@glance-apps/mcp-host';
import { dateEnvelope, isValidLocalDate, localDateOf } from '@glance-apps/mcp-host/dates';

/** thingGLANCE's cursor prefix ("thingGLANCE cursor, version 1"): part of the wire format. */
export const CURSOR_PREFIX = 'tgc1.';

export interface ReadToolDeps {
  bridge: HostBridge;
  /** Epoch ms. */
  now: () => number;
  /** The IANA zone the server resolves dates in, never the client's. */
  timeZone: () => string;
}

type Result = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

export const ok = (data: Record<string, unknown>): Result => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
export const toolError = (code: string, message: string): Result =>
  ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }] });
const bridgeError = (r: Extract<BridgeResult, { ok: false }>) => toolError(r.error.code, r.error.message);
const data = (r: Extract<BridgeResult, { ok: true }>) => (r.data && typeof r.data === 'object' ? r.data as Record<string, unknown> : {});

const PAGING = `Paginated: default page ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}. When truncated is true, pass next_cursor back as cursor ` +
  'for the next page, with the same filters: a cursor is bound to the filters it was issued under, and changing them mid-walk ' +
  'is a validation error.';

const IDS = 'Every id is thingGLANCE\'s own, the same on every device; pass ids exactly as returned, never construct one.';

const THING_NOTE =
  ' A thing\'s verdict says where it is in its life: "prime" and "solid" (plenty left), "watch" (the end is in sight), ' +
  '"replace" (time to plan its replacement), "overdue" (past the end of its window), "retired", or "unknown" (no dates yet). ' +
  'life_end is the earlier of support_end (when security updates stop) and replace_by (the user\'s own plan), and days_left counts to it. ' +
  'coverage_end is the last day any warranty or insurance on it runs.';

const DATE_NOTE =
  ' Each date has a type: "coverage-end" (a warranty or insurance runs out), "support-end" (security updates stop), "replace" ' +
  '(the planned replacement), "renewal" (a plan renews), "trial-end" (a trial converts to paid) or "sub-end" (a plan ends: a ' +
  'cancelled one\'s access runs out, one that does not renew expires, or a lease or installment plan reaches the end of its ' +
  'term). days_away is negative once it has passed, and the date then carries past: true. needs_decision is true while it sits in the queue; state is "open", ' +
  '"done", "dismissed" or "sent" (handed to dayGLANCE as a task). handler_name is the household member it falls to, when it falls to one.';

// A null owner or payer is a value, not a gap.
const HOUSEHOLD_NOTE =
  ' Every "who" follows one rule. Where one member is named (owner, payer, responsible) it is a household member or the ' +
  'household itself: for the household the member id is null, the name is "Household" and owner, payer or responsible is ' +
  '"household". null there never means "not set". A responsible of "household" means nobody in particular deals with it, so ' +
  'everyone is asked. Where several can be named (who a plan is used by) used_by says which: "members" (member_ids and ' +
  'member_names list them, one name for each id), "household" (the household as a whole; both lists are then empty) or ' +
  '"not_set" (nobody has said: do not read an empty member_ids as the household). used_by_source says where that comes from: ' +
  '"set" was chosen by hand, and "thing" is the owner of the thing the plan is attached to, which changes when the thing ' +
  'changes owner ("thing" with "not_set" means its things have different owners, so nothing is assumed).';

const PLAN_NOTE =
  ' On a plan: start_date is the day it began, and start_date_status says where that stands. "recorded": the date is known. ' +
  '"unknown": it began before the user tracked it, and they said so; that is an answer, so do not ask for a date or offer to ' +
  'fill one in. "not_set": nobody has said yet; only these are worth asking about. start_date is null for the last two. ' +
  'paid_to_date is history, the payments made up to yesterday at today\'s price, never mixed with what is coming: its basis is ' +
  '"start_date" when it counts from the plan\'s own start. With no start on record it is "anchor" when it counts from a payment ' +
  'made before the plan was added, and "entry_date" when it counts from the day it was added. An "unknown" start counts the ' +
  'payment its current cycle began with (the plan was already running). A "not_set" start counts a payment before it was ' +
  'added only when the plan\'s renewal date itself is on or before that day; with the renewal date still ahead the plan may be ' +
  'new, and nothing earlier is assumed. Either way it is what is known to have been paid, not everything since the plan ' +
  'began. A plan with auto_renew true and an ' +
  'end_date has a fixed term (a lease, installments): it is paid each cycle until end_date, next_renewal is null once no payment ' +
  'is left, and left_on_term says what remains. With auto_renew false it is already paid for: no renewals, no monthly cost.';

const PRIVACY = ' You see what the member this computer belongs to sees: another member\'s private things and plans are not listed.';

const pagingSchema = {
  limit: z.number().int().optional().describe(`Page size, 1-${MAX_LIST_LIMIT}. Default ${DEFAULT_LIST_LIMIT}.`),
  cursor: z.string().optional().describe("Opaque cursor from a previous response's next_cursor."),
};

function page(items: unknown[], filterKey: string, limit: unknown, cursor: unknown, extra: Record<string, unknown>, tz: string): Result {
  const p = paginate(items, { limit, cursor, filterKey, cursorPrefix: CURSOR_PREFIX });
  if (!p.ok) return toolError('validation', p.reason);
  return ok({ ...extra, items: p.items, truncated: p.truncated, next_cursor: p.nextCursor, total: p.total, timezone: tz });
}

export function registerReadTools(server: McpServer, deps: ReadToolDeps): void {
  const today = () => localDateOf(deps.now(), deps.timeZone());
  const ask = (method: string, params: Record<string, unknown> = {}, timeoutMs?: number) => deps.bridge.request(method, params, timeoutMs);

  server.registerTool(
    'thingglance_ping',
    { description: 'Connectivity check: confirms the thingGLANCE MCP server is reachable. Reads no data.' },
    async () => ok({ ok: true, server: 'thingGLANCE MCP' }),
  );

  server.registerTool(
    'thingglance_get_overview',
    {
      description:
        'Where things stand in thingGLANCE today: counts (things in service, under coverage, plans, dates needing a decision), what the ' +
        'plans cost a month and a year, the charges coming in the next 30 days, the queue of dates that need a decision (most pressing ' +
        'first, at most 50, needs_decision_truncated when there are more), and the next few dates after those. Amounts are in the ' +
        'returned currency. Resolves today on the user\'s machine and echoes the date and IANA timezone. Start here for "what needs ' +
        'my attention" and "what am I paying for".' + DATE_NOTE + PRIVACY,
    },
    async () => {
      const r = await ask('overview');
      if (!r.ok) return bridgeError(r);
      return ok({ ...dateEnvelope(today(), deps.timeZone()), ...data(r) });
    },
  );

  server.registerTool(
    'thingglance_list_things',
    {
      description:
        'The things thingGLANCE tracks, with filters. status: "active" (default), "retired" or "all". category is a category id as ' +
        'returned on a thing. verdict narrows to one verdict. owner: a member id, "me" (this computer\'s member) or "household" (things ' +
        'the household owns together). query matches words in the name, brand, model and category, accents and case ignored. ' +
        'Ordered by what runs out soonest. ' + PAGING + ' ' + IDS + THING_NOTE + HOUSEHOLD_NOTE + PRIVACY,
      inputSchema: z.object({
        status: z.string().optional().describe('active, retired or all. Default active.'),
        category: z.string().optional().describe('A category id, e.g. "phone" or "laptop".'),
        verdict: z.string().optional().describe('prime, solid, watch, replace, overdue, retired or unknown.'),
        owner: z.string().optional().describe('A member id from thingglance_list_members, "me" or "household".'),
        query: z.string().optional().describe('Words to find in the name, brand, model or category.'),
        ...pagingSchema,
      }),
    },
    async ({ status, category, verdict, owner, query, limit, cursor }) => {
      const filter = { status: status ?? 'active', category, verdict, owner, query: query?.trim() || undefined };
      const r = await ask('list_things', filter);
      if (!r.ok) return bridgeError(r);
      return page((data(r).items as unknown[]) ?? [], JSON.stringify(filter), limit, cursor, { today: today() }, deps.timeZone());
    },
  );

  server.registerTool(
    'thingglance_get_thing',
    {
      description:
        'One thing in full: what it is, when it was bought and for how much, its notes and specs, who owns it and who deals with it, ' +
        'every warranty and insurance on it (coverage), the plans attached to it, and its dates: the ones ahead, and any behind that ' +
        'still wait for a decision. owned_since is when the current owner\'s time with it began (the last hand-over, or the day it ' +
        'was bought); ownership_history lists the owners before, oldest first.' + THING_NOTE + DATE_NOTE + HOUSEHOLD_NOTE + PLAN_NOTE,
      inputSchema: z.object({ thing_id: z.string().describe('A thing id from thingglance_list_things.') }),
    },
    async ({ thing_id }) => {
      const r = await ask('get_thing', { thing_id });
      if (!r.ok) return bridgeError(r);
      return ok({ ...dateEnvelope(today(), deps.timeZone()), ...data(r) });
    },
  );

  server.registerTool(
    'thingglance_list_plans',
    {
      description:
        'The plans (subscriptions, memberships, anything that renews) with what each costs and when it next renews, most expensive ' +
        'first. totals is what the plans listed come to a month and a year: it follows the filters (and counts every page, not ' +
        'only this one). all_plans_totals is the same for every plan, whatever the filters. status: "current" (default: active and ' +
        'trials), "active", "trial", "cancelled" or "all". thing_id keeps the plans attached to one thing. used_by keeps the plans ' +
        'one member uses (a member id, or "me" for this computer\'s member): the ones that name them and the ones the household ' +
        'uses as a whole, as the app shows a member\'s plans. exact: true leaves the household\'s out and keeps only the plans that ' +
        'name them. used_by "household" keeps the plans used by the household as a whole. query matches the name ' +
        'and provider. review_before_renewal means the user asked to be asked before it renews. ' + PAGING + ' ' + IDS + HOUSEHOLD_NOTE + PLAN_NOTE + PRIVACY,
      inputSchema: z.object({
        status: z.string().optional().describe('current, active, trial, cancelled or all. Default current.'),
        thing_id: z.string().optional().describe('A thing id: only the plans attached to it.'),
        used_by: z.string().optional().describe('A member id from thingglance_list_members, "me" or "household".'),
        exact: z.boolean().optional().describe('With used_by a member or "me": only the plans that name them, not the household\'s. Default false.'),
        query: z.string().optional().describe('Words to find in the plan name or provider.'),
        ...pagingSchema,
      }),
    },
    async ({ status, thing_id, used_by, exact, query, limit, cursor }) => {
      const filter = { status: status ?? 'current', thing_id, used_by, exact: exact === true ? true : undefined, query: query?.trim() || undefined };
      const r = await ask('list_plans', filter);
      if (!r.ok) return bridgeError(r);
      return page((data(r).items as unknown[]) ?? [], JSON.stringify(filter), limit, cursor, { totals: data(r).totals, all_plans_totals: data(r).all_plans_totals }, deps.timeZone());
    },
  );

  server.registerTool(
    'thingglance_list_upcoming',
    {
      description:
        'The dates between two local days (both included), soonest first: warranties ending, support ending, planned replacements, ' +
        'renewals, trials converting. Default: today to 90 days ahead; at most about three years at once. types narrows to some kinds. ' +
        'thing_id or plan_id narrows to one thing or plan. Routine renewals (a monthly plan nobody asked to review) are left out ' +
        'unless include_routine is true. A from before today also lists what has already happened, each marked past: true; a ' +
        'plan\'s renewals are listed only from its start_date, since nothing was paid before it began, and never on or after the ' +
        'day it ends. For "what is coming up" and "what renews this quarter". ' + PAGING + DATE_NOTE + PRIVACY,
      inputSchema: z.object({
        from: z.string().optional().describe('First local date, YYYY-MM-DD. Default today.'),
        to: z.string().optional().describe('Last local date, YYYY-MM-DD. Default 90 days from today.'),
        types: z.array(z.string()).optional().describe('Any of: coverage-end, support-end, replace, renewal, trial-end, sub-end.'),
        thing_id: z.string().optional(),
        plan_id: z.string().optional(),
        include_routine: z.boolean().optional().describe('Also list routine renewals of short-cycle plans.'),
        ...pagingSchema,
      }),
    },
    async ({ from, to, types, thing_id, plan_id, include_routine, limit, cursor }) => {
      for (const [name, value] of [['from', from], ['to', to]] as const) {
        if (value !== undefined && !isValidLocalDate(value)) return toolError('validation', `${name} must be a local date, YYYY-MM-DD, got ${JSON.stringify(value)}.`);
      }
      const filter = { from, to, types, thing_id, plan_id, include_routine };
      const r = await ask('list_upcoming', filter);
      if (!r.ok) return bridgeError(r);
      const d = data(r);
      return page((d.items as unknown[]) ?? [], JSON.stringify(filter), limit, cursor, { from: d.from, to: d.to }, deps.timeZone());
    },
  );

  server.registerTool(
    'thingglance_list_queue',
    {
      description:
        'Every date that needs a decision now, most pressing first: the full queue the app\'s Glance page shows. A date leaves the ' +
        'queue when the user marks it done or dismisses it (thingglance_decide_event), or hands it to dayGLANCE. ' + PAGING + DATE_NOTE + PRIVACY,
      inputSchema: z.object({ ...pagingSchema }),
    },
    async ({ limit, cursor }) => {
      const r = await ask('list_queue');
      if (!r.ok) return bridgeError(r);
      return page((data(r).items as unknown[]) ?? [], 'queue', limit, cursor, { today: today() }, deps.timeZone());
    },
  );

  server.registerTool(
    'thingglance_list_members',
    {
      description:
        'The household: everyone things are tracked for, whether or not they use the app (uses_the_app), how many things each owns ' +
        'and plans each pays for, which member this computer belongs to (is_this_device), and what belongs to the household itself: ' +
        'household_owns and household_pays_for count the things and plans whose owner or payer is null, and household_uses the ' +
        'plans used by the household as a whole (uses, on a member, counts the plans that name them, by hand or as the owner of ' +
        'the thing a plan is attached to). Member ids are ' +
        'what owner, payer, responsible and member_ids take; null, or the word "household", means the household.',
    },
    async () => {
      const r = await ask('list_members');
      if (!r.ok) return bridgeError(r);
      return ok(data(r));
    },
  );
}

const resourceError = (r: Extract<BridgeResult, { ok: false }>) => new Error(`[${r.error.code}] ${r.error.message}`);

export function registerResources(server: McpServer, deps: ReadToolDeps): void {
  const today = () => localDateOf(deps.now(), deps.timeZone());
  const json = (uri: string, body: unknown) => ({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(body) }] });

  server.registerResource(
    'thingglance-queue',
    'thingglance://queue',
    {
      title: 'Needs a decision',
      description: 'The dates that need a decision now, most pressing first, with today\'s counts. The same data as thingglance_get_overview.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const r = await deps.bridge.request('overview', {});
      if (!r.ok) throw resourceError(r);
      const d = data(r);
      return json(uri.href, { ...dateEnvelope(today(), deps.timeZone()), counts: d.counts, needs_decision: d.needs_decision, needs_decision_truncated: d.needs_decision_truncated });
    },
  );
}
