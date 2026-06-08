import { describe, it, expect } from 'vitest';
import { CLOUD_NIMBUS_FILTERS } from './defaults';
import type { NormalizedTask } from '../types';

function task(partial: Partial<NormalizedTask>): NormalizedTask {
  return { id: 'x', title: 'Untitled', ...partial } as NormalizedTask;
}
const predicate = (id: string) => CLOUD_NIMBUS_FILTERS.find((f) => f.id === id)!.predicate;

describe('VIEW filter ticket-prefix predicates (field coupling)', () => {
  const real = predicate('real');
  const workstreams = predicate('workstreams');

  it('matches the scratch/CN surface where the ticket number is the id', () => {
    expect(real(task({ id: 'T-0228', title: 'CF 2.0 form' }))).toBe(true);
    expect(workstreams(task({ id: 'WS-12', title: 'RR rollup' }))).toBe(true);
  });

  it('matches the MF-Prod surface where id is a SF record id and the number is the title', () => {
    // The bug: a 0.201.0-era predicate matched only `t.id` → 0 items on prod.
    expect(real(task({ id: 'a0X1t000000abcdEAA', title: 'T-0228 · CF 2.0 form' }))).toBe(true);
    expect(workstreams(task({ id: 'a0X1t000000abcdEAA', name: 'WS-12 rollup', title: 'Rollup' }))).toBe(true);
  });

  it('does not match non-ticket work on either surface', () => {
    expect(real(task({ id: 'a0X1t000000abcdEAA', title: 'Ad-hoc fix' }))).toBe(false);
    expect(workstreams(task({ id: 'T-0228', title: 'T-0228 form' }))).toBe(false);
  });
});
