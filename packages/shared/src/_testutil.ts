// Shared test helpers (imported only by *.test.ts). Not part of the public barrel.
import type { NodeView, PodView, Severity } from './types';

export function pod(state: Severity, i = 0): PodView {
  return {
    name: `pod-${state}-${i}`,
    namespace: 'ns',
    workload: 'w',
    node: 'n',
    phase: state === 'gone' ? 'Succeeded' : 'Running',
    state,
    restarts: 0,
  };
}

/** Build a pod list with given counts per state. */
export function pods(ok: number, warn: number, crit: number, gone = 0): PodView[] {
  const out: PodView[] = [];
  for (let i = 0; i < ok; i++) out.push(pod('ok', i));
  for (let i = 0; i < warn; i++) out.push(pod('warn', i));
  for (let i = 0; i < crit; i++) out.push(pod('crit', i));
  for (let i = 0; i < gone; i++) out.push(pod('gone', i));
  return out;
}

export function node(name: string, health: Severity, podList: PodView[]): NodeView {
  return {
    name,
    instanceType: 'm5.xlarge',
    ready: true,
    conditions: {},
    cpu: { usagePct: 10 },
    mem: { usagePct: 10 },
    disk: { usagePct: 10 },
    net: { ready: true },
    health,
    pods: podList,
  };
}
