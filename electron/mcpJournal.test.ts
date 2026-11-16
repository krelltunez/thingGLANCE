import { describe, expect, it } from 'vitest';
import { createJournal, describeUndoOp, isUndoOp, undoGroupKey } from './mcpJournal';

describe('the MCP write journal', () => {
  it('groups a thing\'s changes together, coverage included, and a plan\'s and a date\'s apart', () => {
    expect(undoGroupKey({ kind: 'remove_created_thing', thingId: 't1' })).toBe('thing:t1');
    expect(undoGroupKey({ kind: 'remove_created_coverage', thingId: 't1', coverageId: 'c1' })).toBe('thing:t1');
    expect(undoGroupKey({ kind: 'restore_plan_fields', planId: 'p1', before: {} })).toBe('plan:p1');
    expect(undoGroupKey({ kind: 'restore_decision', eventKey: 'renewal:p1:2026-12-01', before: null })).toBe('event:renewal:p1:2026-12-01');
  });

  it('takes only the kinds the page knows how to undo', () => {
    expect(isUndoOp({ kind: 'restore_thing_fields', thingId: 't1', before: {} })).toBe(true);
    expect(isUndoOp({ kind: 'delete_everything' })).toBe(false);
    expect(isUndoOp(null)).toBe(false);
  });

  it('shows what each changed field was before', () => {
    expect(describeUndoOp({ kind: 'restore_thing_fields', thingId: 't1', before: { name: 'Old', price: null } }))
      .toEqual({ ids: { thing_id: 't1' }, changes: [{ field: 'name', before: 'Old' }, { field: 'price', before: null }] });
    expect(describeUndoOp({ kind: 'restore_decision', eventKey: 'k', before: null })).toEqual({ ids: { event_key: 'k' }, changes: [{ field: 'state', before: 'open' }] });
    expect(describeUndoOp({ kind: 'remove_created_plan', planId: 'p1' })).toEqual({ ids: { plan_id: 'p1' } });
  });

  it('plans an undo newest first, for one item or for all, and forgets what was undone', () => {
    const j = createJournal(() => new Date('2026-11-16T18:00:00Z'));
    j.append({ tool: 'thingglance_create_thing', summary: 'Added "Pixel 9"', op: { kind: 'remove_created_thing', thingId: 't1' } });
    j.append({ tool: 'thingglance_update_plan', summary: 'Edited the plan "Netflix"', op: { kind: 'restore_plan_fields', planId: 'p1', before: { amount: 9.99 } } });
    j.append({ tool: 'thingglance_update_thing', summary: 'Edited "Pixel 9"', op: { kind: 'restore_thing_fields', thingId: 't1', before: { price: null } } });
    expect(j.snapshot().total).toBe(3);
    const one = j.plan('thing:t1');
    expect(one.ops.map((o) => o.kind)).toEqual(['restore_thing_fields', 'remove_created_thing']);
    j.remove(one.seqs);
    expect(j.entries().map((e) => e.op.kind)).toEqual(['restore_plan_fields']);
    expect(j.plan().ops).toHaveLength(1);
  });
});
