// Deterministic mock cluster fixtures (MOCK_SCENARIOS.md). Nothing a test asserts on is random.
// Pod states are derived through the real §2 classifier and node health through the real §3
// classifier, so the fixtures exercise the same code paths the live provider would.

import {
  classifyPod,
  deriveNodeHealth,
  type ContainerStatusLike,
  type NodeView,
  type PodEvent,
  type PodStatusLike,
  type PodView,
} from '@hexwall/shared';

export interface PodRecord {
  view: PodView;
  status: PodStatusLike;
  logs: string[]; // current container logs (raw)
  prevLogs: string[]; // previous-container logs (raw)
  events: PodEvent[];
}

export interface Fixture {
  cluster: string;
  nodes: NodeView[];
  records: Map<string, PodRecord>; // key `${namespace}/${name}`
}

const FIXED_NOW = Date.UTC(2026, 5, 20, 11, 5, 0); // reference "now" for pendingSince math

const OK_LOGS = [
  '2026-06-20T11:00:00Z INFO  service ready, listening on :8080',
  '2026-06-20T11:00:05Z INFO  handled request path=/healthz status=200',
  '2026-06-20T11:00:12Z INFO  cache warm, 1024 keys loaded',
  '2026-06-20T11:00:30Z INFO  heartbeat ok',
];

const PAYMENTS_PREV_LOGS = [
  '2026-06-20T11:02:13Z INFO  starting payments-api v1.8.2',
  '2026-06-20T11:02:14Z INFO  connected to postgres',
  '2026-06-20T11:03:01Z ERROR upstream returned 503 from inventory-svc',
  '2026-06-20T11:03:01Z WARN  retrying request (attempt 2) ... timeout',
  '2026-06-20T11:03:09Z ERROR unhandled exception in worker pool',
  '2026-06-20T11:03:09Z panic: runtime: out of memory',
  '2026-06-20T11:03:09Z signal: killed (exit code 137 / OOMKilled)',
];

const PAYMENTS_CUR_LOGS = [
  '2026-06-20T11:03:40Z INFO  starting payments-api v1.8.2',
  '2026-06-20T11:03:41Z WARN  memory pressure detected, 92% of limit',
  '2026-06-20T11:03:42Z ERROR allocation failed in worker pool',
  '2026-06-20T11:03:42Z fatal: OOMKilled imminent',
];

function key(ns: string, name: string): string {
  return `${ns}/${name}`;
}

function viewFromStatus(status: PodStatusLike): PodView {
  const c = classifyPod(status, FIXED_NOW);
  return {
    name: status.name,
    namespace: status.namespace,
    workload: status.workload,
    node: status.node,
    phase: status.phase,
    state: c.state,
    reason: c.reason,
    message: c.message,
    restarts: c.restarts,
    exitCode: c.exitCode,
    startedAt: status.startedAt,
  };
}

function record(
  status: PodStatusLike,
  opts: { logs?: string[]; prevLogs?: string[]; events?: PodEvent[] } = {},
): PodRecord {
  return {
    view: viewFromStatus(status),
    status,
    logs: opts.logs ?? OK_LOGS,
    prevLogs: opts.prevLogs ?? [],
    events: opts.events ?? [],
  };
}

function okPod(node: string, ns: string, workload: string, n: number): PodRecord {
  const name = `${workload}-${node}-${n}`;
  return record({
    name,
    namespace: ns,
    workload,
    node,
    phase: 'Running',
    startedAt: '2026-06-20T10:00:00Z',
    containerStatuses: [{ name: workload, ready: true, restartCount: 0, state: { running: {} } }],
  });
}

const WORKLOADS = ['web', 'api', 'worker', 'cache', 'ingest'];

const MIN = 60_000;
const HOUR = 60 * MIN;

interface NodeSpec {
  name: string;
  instanceType?: string;
  cpu: { usagePct: number; requestPct?: number };
  mem: { usagePct: number };
  disk: { usagePct: number };
  net: { ready: boolean; lossPct?: number };
  conditions?: Record<string, boolean>;
  ready?: boolean;
  stateAgeMs?: number; // how long the node has been in its current state (drives the wall age badge)
}

function buildNode(spec: NodeSpec, recs: PodRecord[], registry: Map<string, PodRecord>): NodeView {
  for (const r of recs) registry.set(key(r.view.namespace, r.view.name), r);
  const health = deriveNodeHealth({
    ready: spec.ready ?? true,
    conditions: spec.conditions ?? {},
    cpu: spec.cpu,
    mem: spec.mem,
    disk: spec.disk,
    net: spec.net,
  });
  return {
    name: spec.name,
    instanceType: spec.instanceType ?? 'm5.xlarge',
    ready: spec.ready ?? true,
    conditions: spec.conditions ?? {},
    cpu: spec.cpu,
    mem: spec.mem,
    disk: spec.disk,
    net: spec.net,
    health,
    stateAgeMs: spec.stateAgeMs,
    pods: recs.map((r) => r.view),
  };
}

function healthyPods(node: string, count: number, registry: Map<string, PodRecord>): PodRecord[] {
  const out: PodRecord[] = [];
  for (let i = 0; i < count; i++) {
    const workload = WORKLOADS[i % WORKLOADS.length];
    const r = okPod(node, workload, workload, i);
    registry.set(key(r.view.namespace, r.view.name), r);
    out.push(r);
  }
  return out;
}

// ---- The canonical crashing pod (MOCK_SCENARIOS §2) ----
function paymentsCrashPod(node: string): PodRecord {
  const status: PodStatusLike = {
    name: 'payments-api-7f9c8b6d4-q2x9z',
    namespace: 'payments',
    workload: 'payments-api',
    node,
    phase: 'Running',
    startedAt: '2026-06-20T11:03:40Z',
    containerStatuses: [
      {
        name: 'payments-api',
        ready: false,
        restartCount: 8,
        state: { waiting: { reason: 'CrashLoopBackOff', message: 'back-off 5m0s restarting failed container' } },
        lastState: {
          terminated: { reason: 'OOMKilled', exitCode: 137, message: 'Container exceeded memory limit', signal: 9 },
        },
      },
    ],
  };
  return record(status, {
    logs: PAYMENTS_CUR_LOGS,
    prevLogs: PAYMENTS_PREV_LOGS,
    events: [
      {
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off restarting failed container payments-api in pod payments-api-7f9c8b6d4-q2x9z',
        at: '2026-06-20T11:03:10Z',
      },
      {
        type: 'Warning',
        reason: 'Unhealthy',
        message: 'Liveness probe failed: HTTP probe failed with statuscode: 500',
        at: '2026-06-20T11:03:05Z',
      },
    ],
  });
}

function critPod(
  node: string,
  ns: string,
  workload: string,
  name: string,
  reason: string,
  extra: Partial<ContainerStatusLike> = {},
): PodRecord {
  const status: PodStatusLike = {
    name,
    namespace: ns,
    workload,
    node,
    phase: 'Running',
    containerStatuses: [
      { name: workload, ready: false, restartCount: 5, state: { waiting: { reason } }, ...extra },
    ],
  };
  return record(status, {
    logs: [
      `2026-06-20T11:01:00Z INFO  starting ${workload}`,
      `2026-06-20T11:01:02Z ERROR ${reason}: container failed to start`,
      '2026-06-20T11:01:02Z failed with exit code 1',
    ],
    prevLogs: [
      `2026-06-20T11:00:00Z INFO  ${workload} boot`,
      `2026-06-20T11:00:30Z ERROR ${reason} — giving up after retrying`,
    ],
    events: [
      { type: 'Warning', reason, message: `${reason} for container ${workload}`, at: '2026-06-20T11:01:03Z' },
    ],
  });
}

function warnPod(node: string, ns: string, workload: string, name: string): PodRecord {
  const status: PodStatusLike = {
    name,
    namespace: ns,
    workload,
    node,
    phase: 'Running',
    containerStatuses: [{ name: workload, ready: true, restartCount: 4 }],
  };
  return record(status, {
    logs: [
      `2026-06-20T11:02:00Z WARN  ${workload} restarted (4 restarts)`,
      '2026-06-20T11:02:01Z WARN  readiness flapping, retrying',
    ],
    events: [
      { type: 'Warning', reason: 'Unhealthy', message: 'Readiness probe failed, restart count climbing', at: '2026-06-20T11:02:02Z' },
    ],
  });
}

// node ip-10-0-4-91: warn (mem 88), 14 ok / 0 warn / 3 crit (one is the payments crash pod)
function build491(registry: Map<string, PodRecord>): NodeView {
  const node = 'ip-10-0-4-91';
  const recs: PodRecord[] = [
    ...healthyPods(node, 14, registry),
    paymentsCrashPod(node),
    critPod(node, 'checkout', 'checkout', 'checkout-6b7-imgpull', 'ImagePullBackOff'),
    critPod(node, 'ledger', 'ledger', 'ledger-9c2-runerr', 'RunContainerError'),
  ];
  for (const r of recs.slice(14)) registry.set(key(r.view.namespace, r.view.name), r);
  return buildNode(
    { name: node, cpu: { usagePct: 55, requestPct: 70 }, mem: { usagePct: 88 }, disk: { usagePct: 40 }, net: { ready: true, lossPct: 0 }, stateAgeMs: 3 * MIN },
    recs,
    registry,
  );
}

// node ip-10-0-2-45: ok, 15 ok / 0 / 1 crit (one healthy pod is the negative pod-detail target)
function build245(registry: Map<string, PodRecord>): NodeView {
  const node = 'ip-10-0-2-45';
  const recs: PodRecord[] = [
    ...healthyPods(node, 15, registry),
    critPod(node, 'search', 'search', 'search-77d-crashloop', 'CrashLoopBackOff', {
      lastState: { terminated: { reason: 'Error', exitCode: 2, message: 'config parse error' } },
    }),
  ];
  registry.set(key(recs[recs.length - 1].view.namespace, recs[recs.length - 1].view.name), recs[recs.length - 1]);
  return buildNode(
    { name: node, cpu: { usagePct: 35 }, mem: { usagePct: 50 }, disk: { usagePct: 30 }, net: { ready: true }, stateAgeMs: 70 * MIN },
    recs,
    registry,
  );
}

// node ip-10-0-7-30: ok, 8 ok / 0 / 12 crit (widespread)
function build730(registry: Map<string, PodRecord>): NodeView {
  const node = 'ip-10-0-7-30';
  const recs: PodRecord[] = [...healthyPods(node, 8, registry)];
  for (let i = 0; i < 12; i++) {
    const r = critPod(node, 'batch', 'batch', `batch-${node.slice(-2)}-crit-${i}`, 'CrashLoopBackOff');
    registry.set(key(r.view.namespace, r.view.name), r);
    recs.push(r);
  }
  return buildNode(
    { name: node, cpu: { usagePct: 60 }, mem: { usagePct: 55 }, disk: { usagePct: 45 }, net: { ready: true }, stateAgeMs: 42 * MIN },
    recs,
    registry,
  );
}

// node ip-10-0-3-08: ok, 11 ok / 2 warn / 0 crit
function build308(registry: Map<string, PodRecord>): NodeView {
  const node = 'ip-10-0-3-08';
  const recs: PodRecord[] = [
    ...healthyPods(node, 11, registry),
    warnPod(node, 'notify', 'notify', 'notify-3a-restarts'),
    warnPod(node, 'mailer', 'mailer', 'mailer-3b-restarts'),
  ];
  for (const r of recs.slice(11)) registry.set(key(r.view.namespace, r.view.name), r);
  return buildNode(
    { name: node, cpu: { usagePct: 40 }, mem: { usagePct: 60 }, disk: { usagePct: 35 }, net: { ready: true }, stateAgeMs: 12 * MIN },
    recs,
    registry,
  );
}

// node ip-10-0-9-12: crit (disk 96 + DiskPressure), 18 ok / 0 / 0 — NOT folded (border is crit)
function build912(registry: Map<string, PodRecord>): NodeView {
  const node = 'ip-10-0-9-12';
  const recs = healthyPods(node, 18, registry);
  return buildNode(
    {
      name: node,
      cpu: { usagePct: 30 },
      mem: { usagePct: 50 },
      disk: { usagePct: 96 },
      net: { ready: true },
      conditions: { DiskPressure: true },
      stateAgeMs: 7 * HOUR,
    },
    recs,
    registry,
  );
}

// 48 healthy nodes (all fold). One is ip-10-0-6-77, the timeline subject.
function healthyNodeNames(): string[] {
  const names = ['ip-10-0-6-77'];
  for (let i = 0; i < 47; i++) {
    const third = 100 + i;
    const fourth = ((i * 13) % 240) + 10;
    names.push(`ip-10-0-${third}-${fourth}`);
  }
  return names;
}

function buildHealthyNode(name: string, index: number, registry: Map<string, PodRecord>): NodeView {
  const count = 12 + (index % 9); // 12..20
  const recs = healthyPods(name, count, registry);
  return buildNode(
    {
      name,
      cpu: { usagePct: 20 + (index % 20) },
      mem: { usagePct: 30 + (index % 25) },
      disk: { usagePct: 20 + (index % 30) },
      net: { ready: true, lossPct: 0 },
    },
    recs,
    registry,
  );
}

export const CLUSTER_NAME = 'prod-eks-use1';

export function buildCanonicalFixture(): Fixture {
  const registry = new Map<string, PodRecord>();
  const healthy = healthyNodeNames().map((n, i) => buildHealthyNode(n, i, registry));
  const problems = [
    build912(registry),
    build730(registry),
    build491(registry),
    build245(registry),
    build308(registry),
  ];
  return { cluster: CLUSTER_NAME, nodes: [...healthy, ...problems], records: registry };
}

// ---- Timeline mutation for ip-10-0-6-77 (MOCK_SCENARIOS §3) ----
export type TimelineLabel = 't0' | 't1' | 't2' | 't3';

export const TIMELINE_OFFSETS: Record<TimelineLabel, number> = {
  t0: 0,
  t1: 5_000,
  t2: 10_000,
  t3: 60_000,
};

const SIX77 = 'ip-10-0-6-77';

/** Returns the pods for ip-10-0-6-77 at a given timeline label, registering records. */
export function six77Pods(label: TimelineLabel, registry: Map<string, PodRecord>): PodView[] {
  const recs = healthyPods(SIX77, 14, registry);
  if (label === 't1') {
    const crit = critPod(SIX77, 'edge', 'edge', 'edge-677-crit', 'CrashLoopBackOff');
    registry.set(key(crit.view.namespace, crit.view.name), crit);
    recs.push(crit);
  }
  return recs.map((r) => r.view);
}

export { SIX77 };

// ---- Scale fixture `big` (MOCK_SCENARIOS §4) ----
export function buildBigFixture(nodeCount = 400): Fixture {
  const registry = new Map<string, PodRecord>();
  const nodes: NodeView[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(buildHealthyNode(`ip-10-1-${Math.floor(i / 250)}-${i % 250}`, i, registry));
  }
  // a handful of problems
  nodes.push(build912(registry), build730(registry), build491(registry));
  return { cluster: 'big-eks', nodes, records: registry };
}
