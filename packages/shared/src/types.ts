// Authoritative data-model shapes (ARCHITECTURE §4). Consumed by the rollup engine,
// the server API, and the web app. Pure types only — no I/O.

export type Severity = 'ok' | 'warn' | 'crit' | 'gone';
// ok   = healthy / running-ready
// warn = degraded but not down (restarts climbing, pending-too-long, probe failing, pressure-near)
// crit = down/failing (CrashLoopBackOff, OOMKilled, ImagePullBackOff, Error, NotReady, pressure)
// gone = completed/succeeded or terminating (neutral gray; not a problem)

export interface PodView {
  name: string;
  namespace: string;
  workload: string; // owning Deployment/StatefulSet/DaemonSet name
  node: string;
  phase: string; // raw K8s phase
  state: Severity; // derived (FUNCTIONAL_SPEC §2)
  reason?: string; // e.g. 'CrashLoopBackOff', 'OOMKilled'
  message?: string;
  restarts: number;
  exitCode?: number; // from lastState.terminated
  startedAt?: string;
}

export interface NodeResource {
  usagePct: number;
  requestPct?: number;
  pressure?: boolean;
}

export interface NodeView {
  name: string;
  instanceType?: string;
  ready: boolean;
  conditions: Record<string, boolean>; // MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable, ...
  cpu: NodeResource;
  mem: NodeResource;
  disk: NodeResource;
  net: { ready: boolean; lossPct?: number };
  health: Severity; // derived (FUNCTIONAL_SPEC §3)
  stateAgeMs?: number; // how long the node has already been in its current state (seeds changedAt)
  pods: PodView[];
}

// What the wall renders per box. Computed by the rollup engine.
export interface QuartileBox {
  kind: 'node' | 'workload';
  id: string; // node name or workload key
  label: string;
  nodeHealth: Severity; // border color
  podTotal: number; // active pods (excludes 'gone')
  affected: number; // warn+crit pods
  affectedPct: number; // 0..100, rounded
  litHexes: number; // 0..4
  litSeverity: Severity; // color of the lit hexes
  hexes: Severity[]; // length 4
  chip: string; // short node-health chip for the box header (UI_SPEC §2), e.g. 'mem 88%'
  foldEligible: boolean; // nodeHealth==='ok' && litHexes===0
  changedAt: number; // epoch ms of last state change (for sort + hysteresis)
}

export interface ClusterSnapshot {
  cluster: string;
  generatedAt: number;
  boxes: QuartileBox[]; // ONLY the non-folded (problem) boxes, sorted worst-first
  healthyFolded: number; // count of folded healthy nodes
  totals: { nodes: number; pods: number; nodesCrit: number; nodesWarn: number };
}

export interface LogSpan {
  text: string;
  kind: 'plain' | 'warn' | 'crit';
}
export interface LogLine {
  raw: string;
  spans: LogSpan[];
} // highlighter output

export interface PodEvent {
  type: string;
  reason: string;
  message: string;
  at: string;
}

export interface PodCrash {
  reason: string; // CrashLoopBackOff / OOMKilled / Error ... (waiting reason if present)
  exitReason?: string; // underlying lastState.terminated reason, e.g. 'OOMKilled'
  exitCode?: number;
  message?: string;
  previousLogs: LogLine[]; // last-terminated container logs (the `--previous` equivalent)
}

export interface PodDetail {
  pod: PodView;
  crash?: PodCrash; // present when crashing/recently crashed
  events: PodEvent[];
  logs: LogLine[]; // current container logs (highlighted)
}

// ---- Raw-ish K8s-shaped inputs for the pure pod-state machine (FUNCTIONAL_SPEC §2/§8) ----
// Minimal mirror of the fields the classifier/crash-extractor read, so the pure logic can be
// unit-tested without depending on @kubernetes/client-node.

export interface TerminatedStateLike {
  reason?: string;
  exitCode?: number;
  message?: string;
  signal?: number;
}

export interface ContainerStatusLike {
  name?: string;
  ready?: boolean;
  restartCount?: number;
  state?: {
    waiting?: { reason?: string; message?: string };
    running?: { startedAt?: string };
    terminated?: TerminatedStateLike;
  };
  lastState?: { terminated?: TerminatedStateLike };
}

export interface PodStatusLike {
  name: string;
  namespace: string;
  workload: string;
  node: string;
  phase: string;
  deletionTimestamp?: string | null; // set => Terminating
  pendingSince?: number; // epoch ms the pod entered Pending (for the >120s rule)
  startedAt?: string;
  containerStatuses?: ContainerStatusLike[];
}
