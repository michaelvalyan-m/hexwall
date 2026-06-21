// Quartile rollup (FUNCTIONAL_SPEC §4) + wall sort (§6). Pure.

import { SEVERITY_RANK, worst, worstOf } from './config';
import { nodeChip } from './nodeHealth';
import type { NodeView, PodView, QuartileBox, Rollup, Severity } from './types';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// Intensity weights and scale (PLATFORM_MODEL §5). Lives in config in the full platform.
const W_FRACTION = 0.5;
const W_MAGNITUDE = 0.5;
const LOG_MAX = 4; // log10(10000) — 10k affected pods = full intensity

// Compute the generic Rollup for a k8s node from its pods + the node's own health.
// nodeHealth is factored into rollup.severity so the Cell tree aggregates correctly
// (e.g. a crit-border node with all-ok pods still propagates crit severity upward).
export function computeNodeRollup(pods: PodView[], nodeHealth: Severity = 'ok'): Rollup {
  const bySeverity: Record<Severity, number> = { ok: 0, warn: 0, crit: 0, gone: 0 };
  for (const p of pods) bySeverity[p.state]++;
  const active = pods.filter((p) => p.state !== 'gone');
  const total = active.length;
  const affected = bySeverity.warn + bySeverity.crit;
  const affectedFraction = total > 0 ? affected / total : 0;
  const podSeverity: Severity = active.length > 0 ? worstOf(active.map((p) => p.state)) : 'ok';
  const severity = worst(podSeverity, nodeHealth);
  const intensity = clamp(
    W_FRACTION * affectedFraction + W_MAGNITUDE * Math.min(1, Math.log10(affected + 1) / LOG_MAX),
    0,
    1,
  );
  return { severity, total, affected, affectedFraction, intensity, bySeverity };
}

export interface QuartileResult {
  podTotal: number; // active (non-gone) count
  affected: number; // warn+crit among active
  affectedPct: number; // 0..100 rounded
  litHexes: number; // 0..4
  litSeverity: Severity;
  hexes: Severity[]; // length 4
}

// Derive the quartile presentation (hexes) from pods. Does NOT include nodeHealth — the hexes
// only represent pod state; the border color (nodeHealth) is tracked separately on QuartileBox.
export function computeQuartiles(pods: PodView[]): QuartileResult {
  const r = computeNodeRollup(pods); // pod-only rollup (no nodeHealth override)
  const litHexes = clamp(Math.ceil(r.affectedFraction * 4), 0, 4);
  const litSeverity: Severity =
    r.bySeverity.crit > 0 ? 'crit' : r.bySeverity.warn > 0 ? 'warn' : 'ok';
  const hexes: Severity[] = [0, 1, 2, 3].map((i) => (i < litHexes ? litSeverity : 'ok'));
  const affectedPct = Math.round(r.affectedFraction * 100);
  return { podTotal: r.total, affected: r.affected, affectedPct, litHexes, litSeverity, hexes };
}

// Build a QuartileBox from a NodeView. `changedAt` is filled by the engine (defaults to 0).
export function computeBox(node: NodeView, changedAt = 0): QuartileBox {
  const q = computeQuartiles(node.pods);
  // Full rollup includes nodeHealth so crit-border nodes propagate upward correctly (PLATFORM_MODEL §4).
  const rollup = computeNodeRollup(node.pods, node.health);
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
    rollup,
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
