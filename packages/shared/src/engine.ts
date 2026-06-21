// Rollup engine: turns NodeView[] into a ClusterSnapshot with fold + hysteresis (§5/§5.1)
// and sort (§6). Stateful (per-node stableSince + changedAt) but I/O-free and deterministic:
// `now` is always passed in, so hysteresis is unit-testable with an injected clock.

import { CONFIG } from './config';
import { computeBox, sortBoxes } from './rollup';
import type { ClusterSnapshot, NodeView, QuartileBox } from './types';

interface ChangeRec {
  sig: string;
  changedAt: number;
}
interface FoldRec {
  eligibleSince: number | null;
}

export class RollupEngine {
  private changed = new Map<string, ChangeRec>();
  private fold = new Map<string, FoldRec>();
  private seeded = false;
  private lastFoldedIds = new Set<string>();

  private hysteresisMs = CONFIG.FOLD_HYSTERESIS_SECONDS * 1000;

  /** Reset all internal state (used by tests / provider restarts). */
  reset(): void {
    this.changed.clear();
    this.fold.clear();
    this.seeded = false;
    this.lastFoldedIds.clear();
  }

  private boxFor(node: NodeView, now: number): QuartileBox {
    const probe = computeBox(node);
    const sig = `${probe.nodeHealth}|${probe.litSeverity}|${probe.litHexes}`;
    const prev = this.changed.get(node.name);
    let changedAt: number;
    if (!prev) {
      // First time we see this node: honor any pre-existing state age the provider reports
      // (so a node that was already broken for 7h shows "7h", not "0s").
      changedAt = node.stateAgeMs != null ? now - node.stateAgeMs : now;
      this.changed.set(node.name, { sig, changedAt });
    } else if (prev.sig !== sig) {
      changedAt = now; // the box state just changed
      this.changed.set(node.name, { sig, changedAt });
    } else {
      changedAt = prev.changedAt;
    }
    return { ...probe, changedAt };
  }

  private isFolded(box: QuartileBox, now: number): boolean {
    if (!box.foldEligible) {
      this.fold.set(box.id, { eligibleSince: null });
      return false;
    }
    const prev = this.fold.get(box.id);
    let eligibleSince: number;
    if (prev && prev.eligibleSince != null) {
      eligibleSince = prev.eligibleSince; // continuously eligible — keep the original timestamp
    } else if (!this.seeded) {
      // Initial-state nodes that are already eligible fold immediately (DECISIONS D3).
      eligibleSince = now - this.hysteresisMs - 1;
    } else {
      eligibleSince = now; // newly became eligible mid-session — start the hysteresis clock
    }
    this.fold.set(box.id, { eligibleSince });
    return now - eligibleSince >= this.hysteresisMs;
  }

  computeSnapshot(nodes: NodeView[], now: number, cluster = 'cluster'): ClusterSnapshot {
    const boxes: QuartileBox[] = [];
    const foldedIds = new Set<string>();
    let nodesCrit = 0;
    let nodesWarn = 0;
    let pods = 0;

    for (const node of nodes) {
      pods += node.pods.length;
      if (node.health === 'crit') nodesCrit++;
      else if (node.health === 'warn') nodesWarn++;

      const box = this.boxFor(node, now);
      if (this.isFolded(box, now)) {
        foldedIds.add(node.name);
      } else {
        boxes.push(box);
      }
    }

    // Drop fold/changed records for nodes that disappeared.
    const present = new Set(nodes.map((n) => n.name));
    for (const id of [...this.fold.keys()]) if (!present.has(id)) this.fold.delete(id);
    for (const id of [...this.changed.keys()]) if (!present.has(id)) this.changed.delete(id);

    this.seeded = true;
    this.lastFoldedIds = foldedIds;

    return {
      cluster,
      generatedAt: now,
      boxes: sortBoxes(boxes),
      healthyFolded: foldedIds.size,
      totals: { nodes: nodes.length, pods, nodesCrit, nodesWarn },
    };
  }

  getFoldedIds(): Set<string> {
    return new Set(this.lastFoldedIds);
  }
}
