// Quartile rollup (FUNCTIONAL_SPEC §4) + wall sort (§6). Pure.

import { SEVERITY_RANK } from './config';
import { nodeChip } from './nodeHealth';
import type { NodeView, PodView, QuartileBox, Severity } from './types';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface QuartileResult {
  podTotal: number; // active (non-gone) count
  affected: number; // warn+crit among active
  affectedPct: number; // 0..100 rounded
  litHexes: number; // 0..4
  litSeverity: Severity;
  hexes: Severity[]; // length 4
}

export function computeQuartiles(pods: PodView[]): QuartileResult {
  const active = pods.filter((p) => p.state !== 'gone');
  const affectedPods = active.filter((p) => p.state === 'warn' || p.state === 'crit');
  const affected = affectedPods.length;
  const fraction = active.length === 0 ? 0 : affected / active.length;

  const litHexes = clamp(Math.ceil(fraction * 4), 0, 4);

  const anyCrit = affectedPods.some((p) => p.state === 'crit');
  const anyWarn = affectedPods.some((p) => p.state === 'warn');
  const litSeverity: Severity = anyCrit ? 'crit' : anyWarn ? 'warn' : 'ok';

  const hexes: Severity[] = [0, 1, 2, 3].map((i) => (i < litHexes ? litSeverity : 'ok'));
  const affectedPct = Math.round(fraction * 100);

  return { podTotal: active.length, affected, affectedPct, litHexes, litSeverity, hexes };
}

// Build a QuartileBox from a NodeView. `changedAt` is filled by the engine (defaults to 0).
export function computeBox(node: NodeView, changedAt = 0): QuartileBox {
  const q = computeQuartiles(node.pods);
  const foldEligible = node.health === 'ok' && q.litHexes === 0;
  return {
    kind: 'node',
    id: node.name,
    label: node.name,
    nodeHealth: node.health,
    podTotal: q.podTotal,
    affected: q.affected,
    affectedPct: q.affectedPct,
    litHexes: q.litHexes,
    litSeverity: q.litSeverity,
    hexes: q.hexes,
    chip: nodeChip(node),
    foldEligible,
    changedAt,
  };
}

// Sort the wall worst-first (FUNCTIONAL_SPEC §6):
// 1. nodeHealth desc, 2. litSeverity desc then litHexes desc, 3. changedAt desc, 4. id asc.
export function sortBoxes<T extends QuartileBox>(boxes: T[]): T[] {
  return [...boxes].sort((a, b) => {
    const byHealth = SEVERITY_RANK[b.nodeHealth] - SEVERITY_RANK[a.nodeHealth];
    if (byHealth !== 0) return byHealth;
    const byLitSev = SEVERITY_RANK[b.litSeverity] - SEVERITY_RANK[a.litSeverity];
    if (byLitSev !== 0) return byLitSev;
    const byLitHexes = b.litHexes - a.litHexes;
    if (byLitHexes !== 0) return byLitHexes;
    const byChanged = b.changedAt - a.changedAt;
    if (byChanged !== 0) return byChanged;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
