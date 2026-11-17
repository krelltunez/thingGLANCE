// thingGLANCE's MCP write tools (docs/mcp.md is the contract). After
// lastGLANCE's electron/mcpWriteTools.ts. No state here: the gate, the replay
// store, the journal and the bridge are main.ts's, closed over per request.
//
// Every write, in order:
//   1. consent: without "Allow changes" a write is a read_only_mode error;
//   2. replay: a known (token, tool, idempotency_key) returns the first
//      result, with no gate charge and no change;
//   3. the gate: 30 writes a minute per token, and repeated overruns turn
//      writes off until thingGLANCE restarts;
//   4. the page applies it through the functions the app's forms call
//      (src/mcp/writeModel.ts), refusing what a form would not save, and
//      returns the entity plus the undo record, which goes to the journal and
//      never into the tool's output.
//
// A create's id is derived from its idempotency key, so a retry after the
// replay store has forgotten it still finds its own row and changes nothing.
// Nothing is ever deleted.

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  isValidIdempotencyKey, makeStoreKey,
  type HostBridge, type IdempotencyStore, type WriteGate,
} from '@glance-apps/mcp-host';
import { isUndoOp, type McpJournal } from './mcpJournal.js';
import { ok, toolError } from './mcpReadTools.js';
import { WRITE_TIMEOUT_MS } from './mcpRendererBridge.js';

export interface WriteToolDeps {
  bridge: HostBridge;
  gate: WriteGate;
  store: IdempotencyStore<Record<string, unknown>>;
  /** The bearer token: the gate's and the replay store's key. */
  token: () => string;
  /** "Allow changes" in Settings, read per call. */
  includeWrites: () => boolean;
  /** Fired once, when repeated overruns turn writes off. */
  onWritesDisabled: () => void;
  journal?: McpJournal;
  /** After every write that changed something. */
  onWrite?: () => void;
}

/** A row id from the idempotency key: the same key always names the same row. */
export function idFromKey(storeKey: string): string {
  const h = createHash('sha256').update(storeKey).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${(8 | (parseInt(h[16], 16) & 3)).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const KEY = z.string().optional()
  .describe('Optional retry token, 1-128 characters of [A-Za-z0-9_.:-]. Sending the same key again returns the first result and changes nothing. Use one per intended change.');
const DAY = 'a local date, YYYY-MM-DD';
const MEMBER = 'A member id from thingglance_list_members, or null (or "household") for the household.';
// Who a plan is used by: three answers, and the tools keep them apart.
const USED_BY =
  ' Who uses it is member_ids (the members it covers) or used_by "household" (the household as a whole, said on purpose), never ' +
  'both. With neither it is "not_set": nobody has said, which is not the same as the household.';
const NO_DELETE = ' Nothing can be deleted over MCP: removing anything is done in the app.';
const UNDO_NOTE = ' The user can undo this change from thingGLANCE.';
const EDIT_NOTE = ' Send only the fields to change: a field left out is untouched, and null clears one that can be empty.';
// How a plan that ends is recorded: three cases that read alike and are not.
const PLAN_ENDS =
  ' How a plan that ends is recorded. A lease, or anything paid in installments until a date: auto_renew true with end_date, the ' +
  'last day of the term. It is paid each cycle until then, costs what it costs until then, and gets an end-of-term date. Paid up ' +
  'front for a term and not renewing (a prepaid year): auto_renew false with end_date, the day it expires. It then counts as ' +
  'already paid: no renewals, and no monthly cost. Cancelled: status "cancelled" with end_date, the day access runs out. With no ' +
  'end_date, a plan that renews does so until it is cancelled.';

export const CATEGORY_HINT = 'A category id such as phone, laptop, tablet, tv, appliance, car; left out, it is guessed from the name.';

export function registerWriteTools(server: McpServer, deps: WriteToolDeps): void {
  /** The pipeline: consent, replay, gate, then the page. `newId` is the row's id for a create. */
  const write = async (tool: string, key: unknown, method: string, params: (newId: string) => Record<string, unknown>) => {
    if (!deps.includeWrites()) {
      return toolError('read_only_mode', 'thingGLANCE is read-only for assistants: "Allow changes" is off in its Settings. Ask the user to turn it on.');
    }
    let storeKey: string | null = null;
    if (key !== undefined) {
      if (!isValidIdempotencyKey(key)) return toolError('validation', 'idempotency_key must be 1-128 characters of [A-Za-z0-9_.:-].');
      storeKey = makeStoreKey(deps.token(), tool, key);
      const replay = deps.store.get(storeKey);
      if (replay) return ok({ ...replay, replayed: true });
    }
    const admission = deps.gate.tryWrite(deps.token());
    if (!admission.allowed) {
      if (admission.disabledNow) deps.onWritesDisabled();
      return admission.reason === 'writes_disabled'
        ? toolError('writes_disabled', 'Changes have been turned off after repeated overruns of the rate limit. They come back when the user restarts thingGLANCE.')
        : toolError('rate_limited', 'At most 30 changes a minute. Wait before retrying; repeated overruns turn changes off.');
    }
    const r = await deps.bridge.request(method, params(storeKey ? idFromKey(storeKey) : randomUUID()), WRITE_TIMEOUT_MS);
    if (!r.ok) return toolError(r.error.code, r.error.message);
    const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
    const undo = (r as { undo?: { summary?: unknown; op?: unknown } }).undo;
    if (undo && isUndoOp(undo.op) && deps.journal) {
      deps.journal.append({ tool: `thingglance_${tool}`, summary: String(undo.summary ?? ''), op: undo.op, ...(typeof key === 'string' && { idempotencyKey: key }) });
    }
    if (undo) deps.onWrite?.();
    if (storeKey) deps.store.put(storeKey, data);
    return ok(data);
  };

  /** The fields a call names, and only those: null is a value (clear it), absent is untouched. */
  const named = (args: Record<string, unknown>, keys: readonly string[]) =>
    Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));

  server.registerTool(
    'thingglance_create_thing',
    {
      description:
        'Add a thing to track: something with a warranty, a support window or a planned replacement (a phone, a laptop, an ' +
        'appliance). Only the name is required. A purchase date and price let thingGLANCE work out its life and what it costs to ' +
        'own; coverage is added afterwards with thingglance_add_coverage. It is added as shared and owned by the household unless ' +
        'owner_member_id says otherwise; whoever owns it has had it since the purchase date (owned_since), not since today. Returns the thing as it now stands. thingGLANCE is not an inventory: add things whose ' +
        'dates matter, not everything someone owns.' + UNDO_NOTE,
      inputSchema: z.object({
        name: z.string().describe('What it is called, e.g. "Pixel 9" or "Bosch dishwasher".'),
        category: z.string().optional().describe(CATEGORY_HINT),
        brand: z.string().optional(),
        model: z.string().optional(),
        purchase_date: z.string().optional().describe(`When it was bought: ${DAY}.`),
        price: z.number().optional().describe('What it cost, in the app\'s currency.'),
        retailer: z.string().optional(),
        support_end: z.string().optional().describe(`When security or software updates stop: ${DAY}.`),
        lifespan_months: z.number().int().optional().describe('How long the user plans to keep it, in months. Left out, the category\'s usual lifespan applies.'),
        owner_member_id: z.string().optional().describe('A member id from thingglance_list_members. Left out, the household owns it.'),
        notes: z.string().optional(),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('create_thing', args.idempotency_key, 'create_thing', (new_id) => ({
      ...named(args, ['name', 'category', 'brand', 'model', 'purchase_date', 'price', 'retailer', 'support_end', 'lifespan_months', 'owner_member_id', 'notes']), new_id,
    })),
  );

  server.registerTool(
    'thingglance_update_thing',
    {
      description:
        'Edit a thing: any field the app\'s own form edits. retired: true takes it out of service (resale_value records what it sold ' +
        'for), retired: false brings it back. visibility "private" hides it from every device that is not its owner\'s, so it needs ' +
        'an owner. To change who owns or deals with it, use thingglance_reassign_thing.' + EDIT_NOTE + NO_DELETE + UNDO_NOTE,
      inputSchema: z.object({
        thing_id: z.string().describe('A thing id from thingglance_list_things.'),
        name: z.string().optional(),
        category: z.string().optional().describe('A category id, as returned on a thing.'),
        brand: z.string().nullable().optional(),
        model: z.string().nullable().optional(),
        purchase_date: z.string().nullable().optional().describe(`${DAY}.`),
        release_date: z.string().nullable().optional().describe(`When the product came out: ${DAY}.`),
        price: z.number().nullable().optional(),
        retailer: z.string().nullable().optional(),
        support_end: z.string().nullable().optional().describe(`When updates stop: ${DAY}.`),
        lifespan_months: z.number().int().nullable().optional().describe('Months the user plans to keep it; null for the category\'s usual.'),
        notes: z.string().nullable().optional(),
        pinned: z.boolean().optional(),
        visibility: z.string().optional().describe('"shared" or "private".'),
        retired: z.boolean().optional(),
        resale_value: z.number().nullable().optional().describe('What a retired thing sold for.'),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('update_thing', args.idempotency_key, 'update_thing', () => named(args, [
      'thing_id', 'name', 'category', 'brand', 'model', 'purchase_date', 'release_date', 'price', 'retailer', 'support_end', 'lifespan_months',
      'notes', 'pinned', 'visibility', 'retired', 'resale_value',
    ])),
  );

  server.registerTool(
    'thingglance_reassign_thing',
    {
      description:
        'Change whose a thing is (owner_member_id) or who deals with it (responsible_member_id: the member whose devices are asked ' +
        'about its dates), or both. A new owner is one of two things, and correction says which. Left out or false, the thing ' +
        'changed hands today: a hand-me-down, with the earlier owner kept in its history (ownership_history) and the new one\'s ' +
        'time counted from today. correction: true means the owner on record was simply wrong (it was the new owner\'s all along, ' +
        'or the household was the default when it was entered): nothing is added to the history, and the new owner has had it ' +
        'since it was bought. Use correction: true when the user is fixing who owns what, not describing a hand-over. null for the ' +
        'owner means the household; null for responsible means nobody in particular, so everyone is asked. A private thing handed ' +
        'to the household becomes shared.' + UNDO_NOTE,
      inputSchema: z.object({
        thing_id: z.string().describe('A thing id from thingglance_list_things.'),
        owner_member_id: z.string().nullable().optional().describe(MEMBER),
        responsible_member_id: z.string().nullable().optional().describe('A member id, or null (or "household") for the household: nobody in particular, so everyone is asked.'),
        correction: z.boolean().optional().describe('true: the owner was recorded wrong, so no hand-over is added to the history. Default false.'),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('reassign_thing', args.idempotency_key, 'reassign_thing', () => named(args, ['thing_id', 'owner_member_id', 'responsible_member_id', 'correction'])),
  );

  server.registerTool(
    'thingglance_add_coverage',
    {
      description:
        'Add a warranty, an extended warranty or insurance to a thing. end_date is required: it is the date thingGLANCE watches and ' +
        'reminds about. type: "warranty" (default: the maker\'s), "extended" or "insurance". Returns the thing with its coverage.' + UNDO_NOTE,
      inputSchema: z.object({
        thing_id: z.string().describe('A thing id from thingglance_list_things.'),
        name: z.string().describe('What it is called, e.g. "Manufacturer warranty" or "AppleCare+".'),
        end_date: z.string().describe(`The last day it covers: ${DAY}.`),
        type: z.string().optional().describe('warranty, extended or insurance. Default warranty.'),
        start_date: z.string().optional().describe(`${DAY}.`),
        provider: z.string().optional(),
        cost: z.number().optional().describe('What it cost, if anything.'),
        notes: z.string().optional(),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('add_coverage', args.idempotency_key, 'add_coverage', (new_id) => ({
      ...named(args, ['thing_id', 'name', 'end_date', 'type', 'start_date', 'provider', 'cost', 'notes']), new_id,
    })),
  );

  server.registerTool(
    'thingglance_create_plan',
    {
      description:
        'Add a plan: a subscription, a membership, anything that renews and costs money. name and amount are required. cycle is ' +
        '"weekly", "monthly" (default), "quarterly" or "yearly". anchor_date is any date it renewed or will renew on (default today); ' +
        'renewals roll forward from it. A trial needs status "trial" and trial_end. review: true asks the user before each renewal. ' +
        'thing_ids attaches it to things (a phone plan to the phones). start_date is the day it began: its payments are counted ' +
        'from there. Left out, a plan attached to a thing takes the thing\'s purchase date, and a plan on its own has no start ' +
        '(start_date_status "not_set"), so send the date whenever it is known. When the user says it began some time before they ' +
        'tracked it and the day is not known, send start_date_status "unknown" and no start_date: that records the answer, and ' +
        'its payments are counted from the last one on its cycle before today. Never guess a date. Added as shared, paid by the ' +
        'household unless payer_member_id says otherwise.' + USED_BY +
        PLAN_ENDS + UNDO_NOTE,
      inputSchema: z.object({
        name: z.string().describe('What it is called, e.g. "Netflix" or "iCloud+ 2 TB".'),
        amount: z.number().describe('What it charges each cycle, in the app\'s currency.'),
        cycle: z.string().optional().describe('weekly, monthly, quarterly or yearly. Default monthly.'),
        anchor_date: z.string().optional().describe(`A date it renews on: ${DAY}. Default today.`),
        start_date: z.string().optional().describe(`The day it began: ${DAY}. Default: the attached thing's purchase date, else none.`),
        start_date_status: z.string().optional().describe('"unknown": it began before it was tracked and the day is not known. Not with a start_date.'),
        end_date: z.string().optional().describe(`The day it ends, if it has one: ${DAY}. See the description for what that means with auto_renew.`),
        provider: z.string().optional(),
        status: z.string().optional().describe('"active" (default) or "trial".'),
        trial_end: z.string().optional().describe(`When a trial converts to paid: ${DAY}.`),
        auto_renew: z.boolean().optional().describe('Default true.'),
        review: z.boolean().optional().describe('Ask before it renews. Default false.'),
        thing_ids: z.array(z.string()).optional().describe('Thing ids it is attached to.'),
        member_ids: z.array(z.string()).optional().describe('The members who use it: ids from thingglance_list_members.'),
        used_by: z.string().optional().describe('"household": the household as a whole uses it. Not with member_ids.'),
        payer_member_id: z.string().optional().describe('A member id from thingglance_list_members. Left out, or "household", the household pays.'),
        notes: z.string().optional(),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('create_plan', args.idempotency_key, 'create_plan', (new_id) => ({
      ...named(args, ['name', 'amount', 'cycle', 'anchor_date', 'start_date', 'start_date_status', 'end_date', 'provider', 'status', 'trial_end', 'auto_renew', 'review', 'thing_ids', 'member_ids', 'used_by', 'payer_member_id', 'notes']), new_id,
    })),
  );

  server.registerTool(
    'thingglance_update_plan',
    {
      description:
        'Edit a plan: any field the app\'s own form edits. start_date is the day it began, where its payments are counted from; ' +
        'setting one makes start_date_status "recorded". start_date_status "unknown" (with no start_date) records that it began ' +
        'before it was tracked and clears any date; "not_set" clears both, as if it had never been answered. member_ids ' +
        'replaces who uses it; used_by "household" says the household as a whole does and clears the names, and "not_set" ' +
        'clears both. '+
        'thing_ids replaces the things it is attached to. visibility "private" shows it only on the payer\'s devices, so it needs ' +
        'a payer.' + PLAN_ENDS + EDIT_NOTE + NO_DELETE + UNDO_NOTE,
      inputSchema: z.object({
        plan_id: z.string().describe('A plan id from thingglance_list_plans.'),
        name: z.string().optional(),
        amount: z.number().optional(),
        cycle: z.string().optional().describe('weekly, monthly, quarterly or yearly.'),
        anchor_date: z.string().optional().describe(`${DAY}.`),
        provider: z.string().nullable().optional(),
        status: z.string().optional().describe('active, trial or cancelled.'),
        trial_end: z.string().nullable().optional().describe(`${DAY}.`),
        start_date: z.string().nullable().optional().describe(`The day it began: ${DAY}. null clears it.`),
        start_date_status: z.string().optional().describe('"unknown" or "not_set", without a start_date; "recorded" only alongside one.'),
        end_date: z.string().nullable().optional().describe(`The day it ends: ${DAY}. See the description for what that means with auto_renew and status.`),
        auto_renew: z.boolean().optional(),
        review_before_renewal: z.boolean().optional(),
        thing_ids: z.array(z.string()).optional(),
        member_ids: z.array(z.string()).optional().describe('The members who use it. Replaces the list.'),
        used_by: z.string().optional().describe('"household" or "not_set", without member_ids; "members" only alongside them.'),
        payer_member_id: z.string().nullable().optional().describe(MEMBER),
        responsible_member_id: z.string().nullable().optional().describe('A member id, or null (or "household") for the household: everyone is asked.'),
        visibility: z.string().optional().describe('"shared" or "private".'),
        notes: z.string().nullable().optional(),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('update_plan', args.idempotency_key, 'update_plan', () => named(args, [
      'plan_id', 'name', 'amount', 'cycle', 'anchor_date', 'start_date', 'start_date_status', 'provider', 'status', 'trial_end', 'end_date', 'auto_renew', 'review_before_renewal',
      'thing_ids', 'member_ids', 'used_by', 'payer_member_id', 'responsible_member_id', 'visibility', 'notes',
    ])),
  );

  server.registerTool(
    'thingglance_decide_event',
    {
      description:
        'Settle a date in the queue, by its event_key. state "done" (default): it was dealt with (the warranty was claimed or let ' +
        'lapse, the renewal was reviewed). "dismissed": the user does not want to hear about it. "restore": put it back in the queue. ' +
        'This only records the decision: it cancels nothing and renews nothing.' + UNDO_NOTE,
      inputSchema: z.object({
        event_key: z.string().describe('An event_key from thingglance_list_queue, thingglance_get_overview or thingglance_list_upcoming.'),
        state: z.string().optional().describe('done (default), dismissed or restore.'),
        idempotency_key: KEY,
      }),
    },
    async (args) => write('decide_event', args.idempotency_key, 'decide_event', (new_id) => ({ ...named(args, ['event_key', 'state']), new_id })),
  );
}

export function registerJournalReadTool(server: McpServer, journal: McpJournal): void {
  server.registerTool(
    'thingglance_list_mcp_writes',
    {
      description:
        'What assistants changed in thingGLANCE this session, newest first: when, which tool, a summary, the ids, and each changed ' +
        'field\'s value before. Filter by one id. Cleared when thingGLANCE restarts, and as the user undoes changes.',
      inputSchema: z.object({
        thing_id: z.string().optional(),
        plan_id: z.string().optional(),
        event_key: z.string().optional(),
        limit: z.number().int().optional(),
        cursor: z.string().optional(),
      }),
    },
    async ({ thing_id, plan_id, event_key, limit, cursor }) => {
      const page = journal.page({ match: { thing_id, plan_id, event_key }, limit, cursor });
      if (!page.ok) return toolError('validation', page.reason);
      return ok({ items: page.items, truncated: page.truncated, next_cursor: page.nextCursor, total: page.total });
    },
  );
}
