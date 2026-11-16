// thingGLANCE's half of the MCP write journal (docs/mcp.md, "Undo"): the undo
// op vocabulary, how ops group per item, and how the read tool describes them.
// The journal itself (append, snapshot, groups, undo plan, paging) is
// @glance-apps/mcp-host's. It is held in main for the session only, never on
// disk: it covers "undo what the assistant just did", not an audit history, so
// a restart clearing it is by design. After lastGLANCE's electron/mcpJournal.ts.
//
// The ops are built by the page (src/mcp/writeModel.ts, UndoOp), which alone
// holds the before-state, and applied by it again on undo. Main only stores,
// groups and sends them back, so here they are typed loosely and checked by
// kind.

import {
  appendEntry, buildUndoPlan, journalPage, journalSnapshot,
  type JournalDescription, type JournalEntry, type JournalGrouping, type JournalRecord, type JournalSnapshot,
} from '@glance-apps/mcp-host';

export const UNDO_KINDS = [
  'remove_created_thing', 'restore_thing_fields', 'remove_created_coverage',
  'remove_created_plan', 'restore_plan_fields', 'restore_decision',
] as const;
export type UndoKind = (typeof UNDO_KINDS)[number];

export interface UndoOp {
  kind: UndoKind;
  thingId?: string;
  coverageId?: string;
  planId?: string;
  eventKey?: string;
  before?: Record<string, unknown> | string | null;
  [key: string]: unknown;
}

export type McpJournalEntry = JournalEntry<UndoOp>;
export type McpJournalRecord = JournalRecord<UndoOp>;

export function isUndoOp(v: unknown): v is UndoOp {
  return !!v && typeof v === 'object' && (UNDO_KINDS as readonly string[]).includes((v as { kind?: unknown }).kind as string);
}

/** The one item an op reverses: coverage goes with its thing. Throws on a kind it does not know. */
export function undoGroupKey(op: UndoOp): string {
  switch (op.kind) {
    case 'remove_created_thing':
    case 'restore_thing_fields':
    case 'remove_created_coverage':
      return `thing:${op.thingId}`;
    case 'remove_created_plan':
    case 'restore_plan_fields':
      return `plan:${op.planId}`;
    case 'restore_decision':
      return `event:${op.eventKey}`;
    default:
      throw new Error(`unknown undo op kind ${JSON.stringify((op as { kind?: unknown }).kind)}`);
  }
}

export const JOURNAL_GROUPING: JournalGrouping<UndoOp> = { groupKey: undoGroupKey };

/** What the read tool shows of an op: the ids, and each changed field's value before. */
export function describeUndoOp(op: UndoOp): JournalDescription {
  const ids: Record<string, unknown> = {};
  if (op.thingId) ids.thing_id = op.thingId;
  if (op.coverageId) ids.coverage_id = op.coverageId;
  if (op.planId) ids.plan_id = op.planId;
  if (op.eventKey) ids.event_key = op.eventKey;
  if (op.kind === 'restore_decision') return { ids, changes: [{ field: 'state', before: op.before ?? 'open' }] };
  if (op.kind.startsWith('restore_') && op.before && typeof op.before === 'object') {
    return { ids, changes: Object.entries(op.before).map(([field, before]) => ({ field, before })) };
  }
  return { ids };
}

/** The session journal: entries in, snapshots and undo plans out. */
export function createJournal(now: () => Date = () => new Date()) {
  let entries: McpJournalEntry[] = [];
  return {
    append(record: McpJournalRecord): void {
      entries = appendEntry(entries, record, now().toISOString());
    },
    entries: (): McpJournalEntry[] => entries,
    snapshot: (): JournalSnapshot => journalSnapshot(entries, JOURNAL_GROUPING, 50),
    /** The ops to undo (newest first) for one item, or every item, and the entries they come from. */
    plan(groupKey?: string): { ops: UndoOp[]; seqs: number[] } {
      const chosen = groupKey === undefined ? entries : entries.filter((e) => undoGroupKey(e.op) === groupKey);
      return { ops: buildUndoPlan(chosen).ops, seqs: chosen.map((e) => e.seq) };
    },
    /** Drop entries once the page has undone them. */
    remove(seqs: number[]): void {
      const gone = new Set(seqs);
      entries = entries.filter((e) => !gone.has(e.seq));
    },
    page: (opts: { match?: Record<string, unknown>; limit?: unknown; cursor?: unknown }) =>
      journalPage(entries, { ...opts, describe: describeUndoOp, cursorPrefix: 'tgw1.' }),
  };
}

export type McpJournal = ReturnType<typeof createJournal>;
