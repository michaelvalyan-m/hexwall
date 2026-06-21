import { describe, expect, it } from 'vitest';
import { RollupEngine } from './engine';
import { CONFIG } from './config';
import { node, pods } from './_testutil';
import type { NodeView } from './types';

const HYST = CONFIG.FOLD_HYSTERESIS_SECONDS * 1000;

function healthy(name: string): NodeView {
  return node(name, 'ok', pods(15, 0, 0));
}

describe('RollupEngine — initial fold (DECISIONS D3)', () => {
  it('initial-state eligible nodes fold immediately at t0', () => {
    const e = new RollupEngine();
    const nodes = [healthy('a'), healthy('b'), healthy('c'), node('p', 'ok', pods(8, 0, 12))];
    const snap = e.computeSnapshot(nodes, 1000);
    expect(snap.healthyFolded).toBe(3);
    expect(snap.boxes.map((b) => b.id)).toEqual(['p']); // only the problem node
  });

  it('a crit-border node with all-ok pods is NOT folded', () => {
    const e = new RollupEngine();
    const snap = e.computeSnapshot(
      [healthy('a'), node('disk', 'crit', pods(18, 0, 0))],
      1000,
    );
    expect(snap.healthyFolded).toBe(1);
    expect(snap.boxes.map((b) => b.id)).toEqual(['disk']);
  });
});

describe('RollupEngine — hysteresis timeline (MOCK_SCENARIOS §3)', () => {
  it('problem appears instantly; recovery waits FOLD_HYSTERESIS before folding', () => {
    const e = new RollupEngine();
    const t0 = 1_000_000;

    // t0: 3 healthy fold, 1 standing problem present
    const base = [healthy('n1'), healthy('n2'), node('prob', 'ok', pods(8, 0, 12))];
    let snap = e.computeSnapshot(base, t0);
    expect(snap.healthyFolded).toBe(2);
    expect(snap.boxes.map((b) => b.id)).toContain('prob');
    expect(snap.boxes.map((b) => b.id)).not.toContain('n1');

    // t1 (+5s): n1 develops a crit pod → appears IMMEDIATELY, folded count drops
    const t1 = t0 + 5_000;
    const withProblem = [node('n1', 'ok', pods(14, 0, 1)), healthy('n2'), node('prob', 'ok', pods(8, 0, 12))];
    snap = e.computeSnapshot(withProblem, t1);
    expect(snap.healthyFolded).toBe(1);
    expect(snap.boxes.map((b) => b.id)).toContain('n1');

    // t2 (+10s): n1 recovers → eligible again but must remain visible (hysteresis)
    const t2 = t0 + 10_000;
    const recovered = [healthy('n1'), healthy('n2'), node('prob', 'ok', pods(8, 0, 12))];
    snap = e.computeSnapshot(recovered, t2);
    expect(snap.boxes.map((b) => b.id)).toContain('n1'); // still visible
    expect(snap.healthyFolded).toBe(1); // not yet re-folded

    // just before the window closes: still visible
    snap = e.computeSnapshot(recovered, t2 + HYST - 1);
    expect(snap.boxes.map((b) => b.id)).toContain('n1');
    expect(snap.healthyFolded).toBe(1);

    // t3 (>= hysteresis after t2): n1 folds back
    snap = e.computeSnapshot(recovered, t2 + HYST);
    expect(snap.boxes.map((b) => b.id)).not.toContain('n1');
    expect(snap.healthyFolded).toBe(2);
  });

  it('getFoldedIds reflects the last snapshot', () => {
    const e = new RollupEngine();
    e.computeSnapshot([healthy('a'), node('p', 'ok', pods(0, 0, 4))], 1000);
    expect([...e.getFoldedIds()]).toEqual(['a']);
  });

  it('reset() clears state so the next snapshot re-seeds (folds immediately again)', () => {
    const e = new RollupEngine();
    const nodes = [healthy('a'), healthy('b'), node('p', 'ok', pods(8, 0, 12))];
    e.computeSnapshot(nodes, 1000);
    // advance time so 'a'/'b' are well past any hysteresis; they stay folded
    let snap = e.computeSnapshot(nodes, 1_000_000);
    expect(snap.healthyFolded).toBe(2);

    e.reset();
    snap = e.computeSnapshot(nodes, 2_000_000); // first post-reset snapshot seeds again
    expect(snap.healthyFolded).toBe(2);
    expect(e.getFoldedIds().size).toBe(2);
  });
});

describe('RollupEngine — totals + changedAt', () => {
  it('totals count nodes/pods and crit/warn nodes', () => {
    const e = new RollupEngine();
    const snap = e.computeSnapshot(
      [node('a', 'crit', pods(18, 0, 0)), node('b', 'warn', pods(14, 0, 3)), healthy('c')],
      1000,
    );
    expect(snap.totals.nodes).toBe(3);
    expect(snap.totals.nodesCrit).toBe(1);
    expect(snap.totals.nodesWarn).toBe(1);
    expect(snap.totals.pods).toBe(18 + 17 + 15);
  });

  it('seeds changedAt from node.stateAgeMs on first sight (node already broken for a while)', () => {
    const e = new RollupEngine();
    const now = 10_000_000;
    const broken: NodeView = { ...node('aged', 'warn', pods(14, 0, 3)), stateAgeMs: 7 * 60 * 60 * 1000 };
    const snap = e.computeSnapshot([broken], now);
    // changedAt is now minus the reported age, so the box reads "7h old"
    expect(snap.boxes[0].changedAt).toBe(now - 7 * 60 * 60 * 1000);
    // and it stays put on a later tick with the same signature
    const snap2 = e.computeSnapshot([broken], now + 5000);
    expect(snap2.boxes[0].changedAt).toBe(now - 7 * 60 * 60 * 1000);
  });

  it('a node with no stateAgeMs gets changedAt = now on first sight', () => {
    const e = new RollupEngine();
    const snap = e.computeSnapshot([node('fresh', 'warn', pods(14, 0, 3))], 5000);
    expect(snap.boxes[0].changedAt).toBe(5000);
  });

  it('changedAt updates only when the box signature changes', () => {
    const e = new RollupEngine();
    const a1 = node('a', 'warn', pods(14, 0, 3));
    let snap = e.computeSnapshot([a1], 1000);
    expect(snap.boxes[0].changedAt).toBe(1000);
    // same signature at a later time → changedAt unchanged
    snap = e.computeSnapshot([node('a', 'warn', pods(14, 0, 3))], 5000);
    expect(snap.boxes[0].changedAt).toBe(1000);
    // signature changes (more crit) → changedAt advances
    snap = e.computeSnapshot([node('a', 'warn', pods(8, 0, 9))], 9000);
    expect(snap.boxes[0].changedAt).toBe(9000);
  });
});
