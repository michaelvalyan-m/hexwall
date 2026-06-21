// EksAdapter tests (PLATFORM_MODEL §7 / §9.4). Proves the adapter builds the EKS resource Cell
// correctly, honors discover/resourceTree, throws on unknown ids, and — per PLATFORM_MODEL §8 —
// touches ONLY read methods of the ClusterProvider (a recording proxy asserts no write access).

import { describe, expect, it } from 'vitest';
import { EksAdapter } from './eksAdapter';
import { buildCanonicalFixture, CLUSTER_CELL_ID, CLUSTER_NAME } from './fixtures';
import { MockProvider } from './mockProvider';
import { ManualClock, type ClusterProvider } from './provider';

const FIXED_EPOCH = Date.UTC(2026, 5, 20, 11, 5, 0);

function makeAdapter(): { adapter: EksAdapter; mock: MockProvider } {
  const fixture = buildCanonicalFixture();
  const mock = new MockProvider({ fixture, clock: new ManualClock(FIXED_EPOCH) });
  mock.start();
  const adapter = new EksAdapter(mock, CLUSTER_CELL_ID, CLUSTER_NAME, () => FIXED_EPOCH);
  return { adapter, mock };
}

describe('EksAdapter — resource Cell construction', () => {
  it('exposes serviceKind eks and renderKey eks-cluster', () => {
    const { adapter } = makeAdapter();
    expect(adapter.serviceKind).toBe('eks');
    expect(adapter.renderKey).toBe('eks-cluster');
  });

  it('resourceTree builds a resource Cell whose rollup aggregates all 53 nodes', async () => {
    const { adapter } = makeAdapter();
    const cell = await adapter.resourceTree(CLUSTER_CELL_ID);
    expect(cell.id).toBe(CLUSTER_CELL_ID);
    expect(cell.level).toBe('resource');
    expect(cell.kind).toBe('eks');
    expect(cell.renderKey).toBe('eks-cluster');
    expect(cell.label).toBe(CLUSTER_NAME);
    expect(cell.changedAt).toBe(FIXED_EPOCH);
    // 53 nodes, all active (non-gone) pods counted; severity is crit (the cluster has crit nodes/pods).
    expect(cell.rollup.total).toBeGreaterThan(0);
    expect(cell.rollup.severity).toBe('crit');
    expect(cell.rollup.bySeverity.crit).toBeGreaterThan(0);
  });

  it('resourceTree total equals the sum of active pods across the fixture nodes', async () => {
    const { adapter, mock } = makeAdapter();
    const nodes = await mock.getNodes();
    const expectedActive = nodes
      .flatMap((n) => n.pods)
      .filter((p) => p.state !== 'gone').length;
    const cell = await adapter.resourceTree(CLUSTER_CELL_ID);
    expect(cell.rollup.total).toBe(expectedActive);
  });

  it('discover returns a single-element array equal to the resource tree', async () => {
    const { adapter } = makeAdapter();
    const cells = await adapter.discover({ provider: 'aws', accountId: '123456789012' });
    expect(cells).toHaveLength(1);
    expect(cells[0].id).toBe(CLUSTER_CELL_ID);
    expect(cells[0].renderKey).toBe('eks-cluster');
  });

  it('resourceTree rejects an unknown resource id', async () => {
    const { adapter } = makeAdapter();
    await expect(adapter.resourceTree('aws/123456789012/eks/unknown')).rejects.toThrow(
      /unknown resource id/,
    );
  });
});

describe('EksAdapter — read-only (PLATFORM_MODEL §8)', () => {
  it('touches only read methods of the ClusterProvider; no write-shaped access', async () => {
    const accessed: string[] = [];
    const fixture = buildCanonicalFixture();
    const base = new MockProvider({ fixture, clock: new ManualClock(FIXED_EPOCH) });
    base.start();
    // Recording proxy over the provider: every property name read is logged.
    const recorded = new Proxy(base, {
      get(t, prop, recv) {
        if (typeof prop === 'string') accessed.push(prop);
        return Reflect.get(t, prop, recv);
      },
    }) as unknown as ClusterProvider;

    const adapter = new EksAdapter(recorded, CLUSTER_CELL_ID, CLUSTER_NAME, () => FIXED_EPOCH);
    await adapter.discover({ provider: 'aws', accountId: '123456789012' });

    expect(accessed).toContain('getNodes');
    const WRITE_PREFIXES = ['create', 'patch', 'replace', 'delete', 'put', 'post', 'apply', 'set', 'update', 'scale', 'restart'];
    for (const name of new Set(accessed)) {
      const lower = name.toLowerCase();
      for (const bad of WRITE_PREFIXES) {
        expect(lower.startsWith(bad), `unexpected write-ish access: ${name}`).toBe(false);
      }
    }
  });
});
