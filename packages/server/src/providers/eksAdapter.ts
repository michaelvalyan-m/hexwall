// EKS ResourceAdapter (PLATFORM_MODEL §7). Wraps ClusterProvider into the Tessera plugin
// interface so EKS clusters slot into the universal Cell tree without rework. This is the
// single builder for the EKS resource Cell — the /api/cell route delegates to it (§9.4),
// so there is one code path, not a duplicate.

import { boxToCell, buildResourceCell, computeBox, type Cell } from '@tessera/shared';
import type { ClusterProvider, ResourceAdapter } from './provider';

export class EksAdapter implements ResourceAdapter {
  readonly serviceKind = 'eks';
  readonly renderKey = 'eks-cluster';

  constructor(
    private readonly provider: ClusterProvider,
    private readonly clusterId: string,
    private readonly clusterLabel: string,
    // Injectable clock keeps the resource cell's timestamp deterministic in tests.
    private readonly now: () => number = () => Date.now(),
  ) {}

  async discover(_account: { provider: string; accountId: string }): Promise<Cell[]> {
    return [await this.resourceTree(this.clusterId)];
  }

  async resourceTree(resourceId: string): Promise<Cell> {
    if (resourceId !== this.clusterId) {
      throw new Error(`EksAdapter: unknown resource id "${resourceId}"`);
    }
    // Reads only (getNodes); never mutates the cluster (PLATFORM_MODEL §8).
    const nodes = await this.provider.getNodes();
    const nodeCells = nodes.map((n) => boxToCell(computeBox(n), this.clusterId));
    return buildResourceCell(this.clusterId, this.clusterLabel, nodeCells, this.now());
  }
}
