// EKS ResourceAdapter (PLATFORM_MODEL §7). Wraps ClusterProvider into the Tessera plugin
// interface so EKS clusters slot into the universal Cell tree without rework.

import { boxToCell, buildResourceCell, computeBox, type Cell } from '@tessera/shared';
import type { ClusterProvider, ResourceAdapter } from './provider';

export class EksAdapter implements ResourceAdapter {
  readonly serviceKind = 'eks';
  readonly renderKey = 'eks-cluster';

  constructor(
    private readonly provider: ClusterProvider,
    private readonly clusterId: string,
    private readonly clusterLabel: string,
  ) {}

  async discover(_account: { provider: string; accountId: string }): Promise<Cell[]> {
    return [await this.resourceTree(this.clusterId)];
  }

  async resourceTree(resourceId: string): Promise<Cell> {
    if (resourceId !== this.clusterId) {
      throw new Error(`EksAdapter: unknown resource id "${resourceId}"`);
    }
    const nodes = await this.provider.getNodes();
    const nodeCells = nodes.map((n) => boxToCell(computeBox(n), this.clusterId));
    return buildResourceCell(this.clusterId, this.clusterLabel, nodeCells, Date.now());
  }
}
