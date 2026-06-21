// Tests for the Tessera Cell model and recursive rollup (PLATFORM_MODEL §3–§4).

import { describe, expect, it } from 'vitest';
import { boxToCell, buildResourceCell, buildStubCell, rollupFromChildren, rollupLeaf } from './cell';
import { computeBox, computeNodeRollup, intensityFrom } from './rollup';
import { node, pods } from './_testutil';
import type { Cell, Severity } from './types';

const CLUSTER_ID = 'aws/123456789012/eks/test-cluster';

function leafCell(severity: Severity, i: number): Cell {
  return { id: `p${i}`, level: 'pod', kind: 'pod', label: `p${i}`, rollup: rollupLeaf(severity), changedAt: 0 };
}

describe('rollupLeaf — pod base case (PLATFORM_MODEL §4)', () => {
  it('ok pod: total 1, affected 0, severity ok', () => {
    const r = rollupLeaf('ok');
    expect(r.severity).toBe('ok');
    expect(r.total).toBe(1);
    expect(r.affected).toBe(0);
    expect(r.affectedFraction).toBe(0);
    expect(r.intensity).toBe(0);
    expect(r.bySeverity.ok).toBe(1);
  });

  it('warn pod: total 1, affected 1, severity warn', () => {
    const r = rollupLeaf('warn');
    expect(r.severity).toBe('warn');
    expect(r.total).toBe(1);
    expect(r.affected).toBe(1);
    expect(r.affectedFraction).toBe(1);
    expect(r.intensity).toBeGreaterThan(0);
    expect(r.bySeverity.warn).toBe(1);
  });

  it('crit pod: total 1, affected 1, severity crit', () => {
    const r = rollupLeaf('crit');
    expect(r.severity).toBe('crit');
    expect(r.affected).toBe(1);
    expect(r.bySeverity.crit).toBe(1);
  });

  it('gone pod: total 0, affected 0 (gone pods are not leaf units)', () => {
    const r = rollupLeaf('gone');
    expect(r.total).toBe(0);
    expect(r.affected).toBe(0);
    expect(r.intensity).toBe(0);
    expect(r.bySeverity.gone).toBe(1);
  });
});

describe('rollupFromChildren — recursive aggregation (PLATFORM_MODEL §4)', () => {
  it('empty children: zero rollup with ok severity', () => {
    const r = rollupFromChildren([]);
    expect(r.severity).toBe('ok');
    expect(r.total).toBe(0);
    expect(r.affected).toBe(0);
    expect(r.affectedFraction).toBe(0);
  });

  it('aggregates pod counts across a node→resource chain (2 levels)', () => {
    const nodeA = computeBox(node('a', 'ok', pods(3, 0, 0)));
    const nodeB = computeBox(node('b', 'ok', pods(2, 0, 1)));
    const cellA = boxToCell(nodeA, CLUSTER_ID);
    const cellB = boxToCell(nodeB, CLUSTER_ID);
    const resource = buildResourceCell(CLUSTER_ID, 'test', [cellA, cellB], 1000);

    expect(resource.rollup.total).toBe(6); // 3 + 3 active pods
    expect(resource.rollup.affected).toBe(1); // 1 crit
    expect(resource.rollup.severity).toBe('crit');
    expect(Math.round(resource.rollup.affectedFraction * 100)).toBe(17); // 1/6
    expect(resource.renderKey).toBe('eks-cluster');
    expect(resource.level).toBe('resource');
  });

  it('aggregates across three levels: pod → node → resource → account', () => {
    const nodeA = computeBox(node('a', 'ok', pods(5, 2, 0)));
    const nodeB = computeBox(node('b', 'warn', pods(3, 0, 4)));
    const resource = buildResourceCell(
      CLUSTER_ID,
      'test',
      [boxToCell(nodeA, CLUSTER_ID), boxToCell(nodeB, CLUSTER_ID)],
      1000,
    );
    const account = buildStubCell('aws/123456789012', 'account', 'aws', '123456789012', [resource], 'aws');

    expect(account.rollup.total).toBe(14); // 7 + 7
    expect(account.rollup.affected).toBe(6); // 2 warn + 4 crit
    expect(account.rollup.severity).toBe('crit');
    expect(account.rollup.bySeverity.ok).toBe(8);
    expect(account.rollup.bySeverity.warn).toBe(2);
    expect(account.rollup.bySeverity.crit).toBe(4);
    expect(account.level).toBe('account');
  });

  it('crit-border all-ok node propagates crit severity upward (FUNCTIONAL_SPEC §3 × PLATFORM_MODEL §4)', () => {
    // ip-10-0-9-12 scenario: nodeHealth=crit (DiskPressure), all pods ok
    const critBorder = computeBox(node('disk-node', 'crit', pods(18, 0, 0)));
    const cell = boxToCell(critBorder, CLUSTER_ID);

    expect(cell.rollup.severity).toBe('crit'); // crit border propagates up
    expect(cell.rollup.affected).toBe(0); // no affected pods
    expect(cell.rollup.total).toBe(18);

    const resource = buildResourceCell(CLUSTER_ID, 'test', [cell], 1000);
    expect(resource.rollup.severity).toBe('crit'); // propagated through the tree
    expect(resource.rollup.affected).toBe(0);
  });

  it('bySeverity counts are summed correctly across children', () => {
    const nodeA = computeBox(node('a', 'ok', pods(5, 2, 0)));
    const nodeB = computeBox(node('b', 'ok', pods(3, 0, 4)));
    const resource = buildResourceCell(
      CLUSTER_ID,
      'test',
      [boxToCell(nodeA, CLUSTER_ID), boxToCell(nodeB, CLUSTER_ID)],
      1000,
    );

    expect(resource.rollup.bySeverity.ok).toBe(8); // 5 + 3
    expect(resource.rollup.bySeverity.warn).toBe(2);
    expect(resource.rollup.bySeverity.crit).toBe(4);
    expect(resource.rollup.bySeverity.gone).toBe(0);
  });

  it('intensity increases with more affected pods (log-scaled magnitude)', () => {
    const few = buildResourceCell(CLUSTER_ID, 't', [
      boxToCell(computeBox(node('a', 'ok', pods(99, 0, 1))), CLUSTER_ID),
    ], 0);
    const many = buildResourceCell(CLUSTER_ID, 't', [
      boxToCell(computeBox(node('a', 'ok', pods(0, 0, 1000))), CLUSTER_ID),
    ], 0);

    expect(many.rollup.intensity).toBeGreaterThan(few.rollup.intensity);
    expect(few.rollup.intensity).toBeGreaterThan(0);
    expect(many.rollup.intensity).toBeLessThanOrEqual(1);
  });

  it('non-empty children that are all gone roll up to a zero/ok rollup', () => {
    // exercises the total===0 branch of rollupFromChildren with a non-empty children array
    const cells = [
      boxToCell(computeBox(node('g1', 'ok', pods(0, 0, 0, 5))), CLUSTER_ID),
      boxToCell(computeBox(node('g2', 'ok', pods(0, 0, 0, 3))), CLUSTER_ID),
    ];
    const r = rollupFromChildren(cells);
    expect(r.total).toBe(0);
    expect(r.affected).toBe(0);
    expect(r.affectedFraction).toBe(0);
    expect(r.intensity).toBe(0);
    expect(r.severity).toBe('ok');
    expect(r.bySeverity.gone).toBe(8);
  });
});

describe('intensity — single source of truth (PLATFORM_MODEL §4/§5)', () => {
  it('rollupLeaf warn pins the exact §5 formula value', () => {
    // 0.5*1 + 0.5*min(1, log10(2)/4) — freezes the CONFIG weights for the leaf base case.
    const expected = 0.5 * 1 + 0.5 * Math.min(1, Math.log10(2) / 4);
    expect(rollupLeaf('warn').intensity).toBeCloseTo(expected, 12);
    expect(rollupLeaf('crit').intensity).toBeCloseTo(expected, 12); // same affected=1 magnitude
    expect(rollupLeaf('ok').intensity).toBe(0);
    expect(rollupLeaf('gone').intensity).toBe(0);
  });

  it('node-level and aggregated rollups compute identical intensity for the same pods', () => {
    // Locks computeNodeRollup, rollupLeaf and rollupFromChildren to the one intensityFrom helper.
    for (const [ok, warn, crit] of [[8, 2, 3], [99, 0, 1], [0, 0, 20], [5, 5, 0]]) {
      const mix = pods(ok, warn, crit);
      const flat = computeNodeRollup(mix);
      const agg = rollupFromChildren(mix.map((p, i) => leafCell(p.state, i)));
      expect(agg.total).toBe(flat.total);
      expect(agg.affected).toBe(flat.affected);
      expect(agg.affectedFraction).toBeCloseTo(flat.affectedFraction, 12);
      expect(agg.intensity).toBeCloseTo(flat.intensity, 12);
      expect(agg.intensity).toBeCloseTo(intensityFrom(flat.affected, flat.affectedFraction), 12);
    }
  });
});

describe('boxToCell — Cell id encoding (PLATFORM_MODEL §6)', () => {
  it('node cell id is <clusterId>/node/<nodeName>', () => {
    const box = computeBox(node('ip-10-0-4-91', 'warn', pods(14, 0, 3)));
    const cell = boxToCell(box, CLUSTER_ID);
    expect(cell.id).toBe(`${CLUSTER_ID}/node/ip-10-0-4-91`);
    expect(cell.level).toBe('node');
    expect(cell.kind).toBe('node');
  });
});
