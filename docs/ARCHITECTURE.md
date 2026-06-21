# Architecture — Hexwall

## 1. Shape of the system

```
                +------------------ browser (web app) ------------------+
                |  React + SVG honeycomb wall, zoom, pod-detail view     |
                +-------------------------^-----------------------------+
                          REST (snapshots, detail)  |  SSE (live updates, log stream)
                +-------------------------v-----------------------------+
                |                 server (Node + TS)                     |
                |  - REST + SSE endpoints                                |
                |  - Rollup engine (quartiles, node health, fold, sort) |
                |  - Log tokenizer / highlighter                        |
                |  - ClusterProvider interface                          |
                |        |                         |                    |
                |   MockProvider              KubeProvider (optional)   |
                |  (deterministic)         (@kubernetes/client-node)    |
                +-------------------------^-----------------------------+
                                          | watch / list / read / logs (READ ONLY)
                                   (real cluster, only when selected)
```

In a real deployment the server runs **inside the cluster** as a Deployment, bound to a
read-only `ClusterRole`, exposing the UI via an Ingress or port-forward. Data stays in the
cluster. For the POC this is documented but not required; the server runs locally with
`MockProvider`.

## 2. Monorepo layout (the agent should create this)

```
hexwall/
  package.json                 # npm workspaces root
  packages/
    shared/                    # shared TypeScript types + the pure rollup logic (no I/O)
      src/types.ts
      src/rollup.ts            # quartile math, node-health classification, fold logic, sort
      src/logTokens.ts         # error-token tokenizer/highlighter (pure)
      src/*.test.ts
    server/                    # Node + TS API
      src/index.ts             # bootstraps Fastify (or Express) + SSE
      src/providers/provider.ts        # ClusterProvider interface
      src/providers/mockProvider.ts    # deterministic fixtures (see MOCK_SCENARIOS.md)
      src/providers/kubeProvider.ts    # real, optional
      src/routes/*.ts
      src/*.test.ts
    web/                       # React + Vite
      src/App.tsx
      src/components/Wall.tsx
      src/components/NodeBox.tsx        # box border + 4 quartile hexes
      src/components/Honeycomb.tsx      # real per-pod honeycomb (node detail)
      src/components/PodDetail.tsx      # logs + crash reason
      src/components/Hex.tsx
      src/api.ts
  e2e/                         # Playwright specs
  docs/
```

Keep the **pure logic** (rollup math, node-health classification, fold, log tokenizing) in
`packages/shared` with **no I/O**, so it is trivially unit-testable and shared by both server
and web. This is important for "test every aspect."

## 3. Tech stack (chosen for build speed + testability)

- **Language:** TypeScript, `strict: true`, everywhere.
- **Runtime:** Node 20+.
- **Package manager:** npm workspaces (no extra tooling to install).
- **Server:** Fastify (or Express — Fastify preferred), `zod` for response schemas.
- **Real K8s client:** `@kubernetes/client-node` (used only by `KubeProvider`).
- **Transport:** REST for snapshots/detail; **SSE** for live cluster updates and log streaming
  (simpler than WebSocket, push-only, easy to test).
- **Web:** React 18 + Vite. SVG for the honeycomb. State with React hooks (or a tiny store like
  Zustand if needed). Plain CSS (no Tailwind requirement) — colors via CSS variables so a
  later dark mode is trivial.
- **Tests:** Vitest (unit + integration), Playwright (e2e). `@vitest/coverage-v8` for coverage.
- **Quality:** ESLint + Prettier + `tsc -b`.

> If the agent has a strong reason to deviate (e.g., a dependency won't install), it may, but
> must record the decision and rationale in `DECISIONS.md`.

## 4. Data model (authoritative type shapes)

These live in `packages/shared/src/types.ts`. The rollup engine and the API both use them.

```ts
export type Severity = 'ok' | 'warn' | 'crit' | 'gone';
// ok   = healthy / running-ready
// warn = degraded but not down (restarts climbing, pending-too-long, probe failing, pressure-near)
// crit = down/failing (CrashLoopBackOff, OOMKilled, ImagePullBackOff, Error, NotReady, pressure)
// gone = completed/succeeded or terminating (neutral gray; not a problem)

export interface PodView {
  name: string;
  namespace: string;
  workload: string;            // owning Deployment/StatefulSet/DaemonSet name
  node: string;
  phase: string;               // raw K8s phase
  state: Severity;             // derived (FUNCTIONAL_SPEC §2)
  reason?: string;             // e.g. 'CrashLoopBackOff', 'OOMKilled'
  message?: string;
  restarts: number;
  exitCode?: number;           // from lastState.terminated
  startedAt?: string;
}

export interface NodeResource { usagePct: number; requestPct?: number; pressure?: boolean; }

export interface NodeView {
  name: string;
  instanceType?: string;
  ready: boolean;
  conditions: Record<string, boolean>;   // MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable, ...
  cpu: NodeResource;
  mem: NodeResource;
  disk: NodeResource;
  net: { ready: boolean; lossPct?: number };
  health: Severity;            // derived (FUNCTIONAL_SPEC §3)
  pods: PodView[];
}

// What the wall renders per box. Computed by the rollup engine.
export interface QuartileBox {
  kind: 'node' | 'workload';
  id: string;                  // node name or workload key
  label: string;
  nodeHealth: Severity;        // border color
  podTotal: number;            // active pods (excludes 'gone')
  affected: number;            // warn+crit pods
  affectedPct: number;         // 0..100, rounded
  litHexes: number;            // 0..4
  litSeverity: Severity;       // color of the lit hexes
  hexes: Severity[];           // length 4
  foldEligible: boolean;       // nodeHealth==='ok' && litHexes===0
  changedAt: number;           // epoch ms of last state change (for sort + hysteresis)
}

export interface ClusterSnapshot {
  cluster: string;
  generatedAt: number;
  boxes: QuartileBox[];        // ONLY the non-folded (problem) boxes, sorted worst-first
  healthyFolded: number;       // count of folded healthy nodes
  totals: { nodes: number; pods: number; nodesCrit: number; nodesWarn: number };
}

export interface LogSpan { text: string; kind: 'plain' | 'warn' | 'crit'; }
export interface LogLine { raw: string; spans: LogSpan[]; }   // highlighter output

export interface PodDetail {
  pod: PodView;
  crash?: {                    // present when crashing/recently crashed
    reason: string;            // CrashLoopBackOff / OOMKilled / Error ...
    exitCode?: number;
    message?: string;
    previousLogs: LogLine[];   // last-terminated container logs (the `--previous` equivalent)
  };
  events: { type: string; reason: string; message: string; at: string }[];
  logs: LogLine[];             // current container logs (highlighted)
}
```

## 5. API surface

| Method | Path | Returns | Notes |
|---|---|---|---|
| GET | `/api/snapshot` | `ClusterSnapshot` | folded + sorted, ready to render |
| GET | `/api/stream` | SSE of `ClusterSnapshot` | pushes a new snapshot on every change/tick |
| GET | `/api/node/:name` | `NodeView` | full per-pod detail for node-detail zoom |
| GET | `/api/pod/:ns/:name` | `PodDetail` | crash reason + highlighted logs + events |
| GET | `/api/pod/:ns/:name/logs` | SSE of `LogLine` | live, on-demand log stream |
| GET | `/api/healthy` | `{ nodes: NodeView[] }` | the folded healthy nodes (revealed on click) |

All endpoints are **read-only**. There are no POST/PUT/PATCH/DELETE routes that touch cluster
state. (A health/readiness endpoint for the server itself is fine.)

## 6. ClusterProvider interface

```ts
export interface ClusterProvider {
  // Push the current cluster state; called on watch events or mock ticks.
  onChange(cb: (nodes: NodeView[]) => void): void;
  getNodes(): Promise<NodeView[]>;
  getNode(name: string): Promise<NodeView | null>;
  getPodDetail(ns: string, name: string): Promise<PodDetail | null>;
  streamPodLogs(ns: string, name: string, cb: (line: string) => void): () => void; // returns unsubscribe
  // NOTE: there is deliberately NO method that writes. The interface cannot mutate.
}
```

- `MockProvider` plays the deterministic fixtures and a scripted timeline (see
  `MOCK_SCENARIOS.md`) to exercise live updates and fold hysteresis. **Default.**
- `KubeProvider` wraps `@kubernetes/client-node`: `Watch` on nodes/pods/events, metrics from
  `metrics.k8s.io` (metrics-server) when available, logs via the `Log` API, previous-container
  logs via `previous: true`. Selected by env var `HEXWALL_PROVIDER=kube` with a kubeconfig.

The rollup engine consumes `NodeView[]` from whichever provider and produces
`ClusterSnapshot`. The engine is identical regardless of provider — so testing it against the
mock fully validates the real path's output too.

## 7. Deployment model (documentation; not required for POC acceptance)

- Server packaged as a container, deployed as a Deployment with a read-only `ClusterRole`
  (`get`/`list`/`watch` on nodes, pods, events; access to `metrics.k8s.io`; `pods/log`).
- EKS: bind via an IAM access entry mapped to the read-only role.
- On-demand log streaming only when a user opens a pod — the server does **not** ingest all
  logs continuously (that is what makes such tools heavy/expensive).
- Events are persisted by the server (in-memory ring buffer for the POC) because the K8s API
  expires them after ~1h.
