// Node health classification (FUNCTIONAL_SPEC §3). Pure.
// health = worst(condition signals, utilization signals). Independent of pod state.

import { CONFIG, SEVERITY_RANK, worstOf } from './config';
import type { NodeResource, Severity } from './types';

export interface NodeHealthInput {
  ready: boolean;
  conditions: Record<string, boolean>; // MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable, ...
  cpu: NodeResource;
  mem: NodeResource;
  disk: NodeResource;
  net: { ready: boolean; lossPct?: number };
}

const PRESSURE_CONDITIONS = ['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'];

export function deriveNodeHealth(node: NodeHealthInput): Severity {
  const signals: Severity[] = [];

  // ---- Condition signals → crit ----
  if (node.ready === false) signals.push('crit'); // NotReady
  for (const cond of PRESSURE_CONDITIONS) {
    if (node.conditions[cond] === true) signals.push('crit');
  }
  // NetworkUnavailable can also be expressed via net.ready === false.
  if (node.net.ready === false) signals.push('crit');

  // ---- Utilization signals ----
  if (node.mem.usagePct >= CONFIG.MEM_CRIT) signals.push('crit');
  else if (node.mem.usagePct >= CONFIG.MEM_WARN) signals.push('warn');

  if (node.disk.usagePct >= CONFIG.DISK_CRIT) signals.push('crit');
  else if (node.disk.usagePct >= CONFIG.DISK_WARN) signals.push('warn');

  if (node.cpu.usagePct >= CONFIG.CPU_WARN) signals.push('warn');
  if ((node.cpu.requestPct ?? 0) >= 100) signals.push('warn'); // requests-vs-usage trap

  if ((node.net.lossPct ?? 0) >= CONFIG.NET_WARN) signals.push('warn');

  if (signals.length === 0) return 'ok';
  return worstOf([...signals, 'ok']);
}

// A short condition chip for a node (UI_SPEC §2): 'healthy' | 'mem 88%' | 'disk 96%' | ...
// Picks the worst-severity metric, breaking ties by a fixed priority order.
export function nodeChip(node: {
  health: Severity;
  ready: boolean;
  conditions: Record<string, boolean>;
  cpu: NodeResource;
  mem: NodeResource;
  disk: NodeResource;
  net: { ready: boolean; lossPct?: number };
}): string {
  if (node.health === 'ok') return 'healthy';
  if (node.ready === false) return 'NotReady';

  type Candidate = { sev: Severity; text: string };
  const cands: Candidate[] = [];
  const sev = (warn: boolean, crit: boolean): Severity => (crit ? 'crit' : warn ? 'warn' : 'ok');

  cands.push({
    sev: sev(node.mem.usagePct >= CONFIG.MEM_WARN, node.mem.usagePct >= CONFIG.MEM_CRIT),
    text: `mem ${Math.round(node.mem.usagePct)}%`,
  });
  cands.push({
    sev: sev(node.disk.usagePct >= CONFIG.DISK_WARN, node.disk.usagePct >= CONFIG.DISK_CRIT),
    text: `disk ${Math.round(node.disk.usagePct)}%`,
  });
  cands.push({
    sev: sev(node.cpu.usagePct >= CONFIG.CPU_WARN, false),
    text: `cpu ${Math.round(node.cpu.usagePct)}%`,
  });
  if ((node.cpu.requestPct ?? 0) >= 100) {
    cands.push({ sev: 'warn', text: `req ${Math.round(node.cpu.requestPct ?? 0)}%` });
  }
  if ((node.net.lossPct ?? 0) >= CONFIG.NET_WARN) {
    cands.push({ sev: 'warn', text: `net ${Math.round(node.net.lossPct ?? 0)}% loss` });
  }
  for (const cond of PRESSURE_CONDITIONS) {
    if (node.conditions[cond] === true) cands.push({ sev: 'crit', text: cond });
  }

  // Highest severity wins; the array order above is the tiebreak (mem, disk, cpu, ...).
  const best = cands
    .filter((c) => c.sev !== 'ok')
    .sort((a, b) => SEVERITY_RANK[b.sev] - SEVERITY_RANK[a.sev])[0];
  return best ? best.text : node.health;
}
