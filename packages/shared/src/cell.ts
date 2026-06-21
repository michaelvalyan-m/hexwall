// Tessera platform Cell model helpers (PLATFORM_MODEL §3–§4).
// Pure functions — no I/O. Builds Cell trees from EKS rollup data and computes
// recursive rollups that aggregate correctly from pod → node → resource → account → provider.

import { worstOf } from './config';
import { intensityFrom } from './rollup';
import type { Cell, Level, QuartileBox, Rollup, Severity } from './types';

const ZERO_BY_SEVERITY: Record<Severity, number> = { ok: 0, warn: 0, crit: 0, gone: 0 };

/** Pod base case: roll up a single leaf pod into a Rollup (PLATFORM_MODEL §4). */
export function rollupLeaf(severity: Severity): Rollup {
  const active = severity !== 'gone';
  const affected = severity === 'warn' || severity === 'crit' ? 1 : 0;
  const total = active ? 1 : 0;
  const affectedFraction = total > 0 ? affected : 0;
  return {
    severity,
    total,
    affected,
    affectedFraction,
    intensity: intensityFrom(affected, affectedFraction),
    bySeverity: { ...ZERO_BY_SEVERITY, [severity]: 1 },
  };
}

/** Recursive aggregate rollup from a collection of child Cells (PLATFORM_MODEL §4). */
export function rollupFromChildren(children: Cell[]): Rollup {
  if (children.length === 0) {
    return {
      severity: 'ok',
      total: 0,
      affected: 0,
      affectedFraction: 0,
      intensity: 0,
      bySeverity: { ...ZERO_BY_SEVERITY },
    };
  }
  const severity = worstOf(children.map((c) => c.rollup.severity));
  const total = children.reduce((s, c) => s + c.rollup.total, 0);
  const affected = children.reduce((s, c) => s + c.rollup.affected, 0);
  const affectedFraction = total > 0 ? affected / total : 0;
  const bySeverity: Record<Severity, number> = { ...ZERO_BY_SEVERITY };
  for (const c of children) {
    for (const k of ['ok', 'warn', 'crit', 'gone'] as Severity[]) {
      bySeverity[k] += c.rollup.bySeverity[k];
    }
  }
  const intensity = intensityFrom(affected, affectedFraction);
  return { severity, total, affected, affectedFraction, intensity, bySeverity };
}

/** Convert a QuartileBox (the wall's node entry) into a Cell for higher-level aggregation. */
export function boxToCell(box: QuartileBox, clusterCellId: string): Cell {
  return {
    id: `${clusterCellId}/node/${box.id}`,
    level: 'node',
    kind: 'node',
    label: box.label,
    rollup: box.rollup,
    changedAt: box.changedAt,
  };
}

/** Build the EKS resource-level Cell (renderKey: 'eks-cluster') from its node Cells. */
export function buildResourceCell(
  cellId: string,
  label: string,
  nodeCells: Cell[],
  generatedAt: number,
): Cell {
  return {
    id: cellId,
    level: 'resource',
    kind: 'eks',
    label,
    renderKey: 'eks-cluster',
    rollup: rollupFromChildren(nodeCells),
    changedAt: generatedAt,
  };
}

/** Build a stub Cell for a parent level (account, service, provider, estate). */
export function buildStubCell(
  id: string,
  level: Level,
  kind: string,
  label: string,
  children: Cell[],
  provider?: string,
): Cell {
  return {
    id,
    level,
    kind,
    label,
    provider,
    rollup: rollupFromChildren(children),
    changedAt: children.reduce((m, c) => Math.max(m, c.changedAt), 0),
    children,
  };
}
