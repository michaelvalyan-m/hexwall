// KubeProvider — the real, optional path (@kubernetes/client-node). READ-ONLY: it issues only
// list/read/watch verbs and reads logs. It NEVER calls create/patch/replace/delete. Selected via
// HEXWALL_PROVIDER=kube. Not required to run against a live cluster — but it must compile, be
// typed, and be proven read-only by a spied unit test (FUNCTIONAL_SPEC §9 / TEST_PLAN §3).

import {
  classifyPod,
  deriveNodeHealth,
  extractCrash,
  highlightAll,
  type ContainerStatusLike,
  type NodeView,
  type PodDetail,
  type PodEvent,
  type PodStatusLike,
  type PodView,
} from '@tessera/shared';
import type { ClusterProvider } from './provider';

// The narrow read-only surface this provider depends on. Only list/read methods — by
// construction there is no write method here, and the spy test asserts none is ever called.
export interface ReadOnlyCoreApi {
  listNode(): Promise<any>;
  listPodForAllNamespaces(): Promise<any>;
  listNamespacedEvent(arg: { namespace: string }): Promise<any>;
  readNamespacedPodLog(arg: {
    namespace: string;
    name: string;
    previous?: boolean;
    tailLines?: number;
  }): Promise<any>;
}

export interface ReadOnlyWatch {
  watch(
    path: string,
    queryParams: Record<string, unknown>,
    onEvent: (type: string, obj: any) => void,
    onError: (err: unknown) => void,
  ): Promise<{ abort(): void }>;
}

export interface KubeProviderOptions {
  core?: ReadOnlyCoreApi;
  watch?: ReadOnlyWatch;
}

function items(res: any): any[] {
  return res?.items ?? res?.body?.items ?? [];
}

function podToStatus(pod: any): PodStatusLike {
  const meta = pod.metadata ?? {};
  const status = pod.status ?? {};
  const ownerName: string =
    meta.ownerReferences?.[0]?.name ??
    meta.labels?.['app.kubernetes.io/name'] ??
    meta.labels?.app ??
    meta.generateName?.replace(/-$/, '') ??
    meta.name;
  const containerStatuses: ContainerStatusLike[] = (status.containerStatuses ?? []).map((c: any) => ({
    name: c.name,
    ready: c.ready,
    restartCount: c.restartCount,
    state: c.state,
    lastState: c.lastState,
  }));
  let pendingSince: number | undefined;
  if (status.phase === 'Pending' && meta.creationTimestamp) {
    pendingSince = new Date(meta.creationTimestamp).getTime();
  }
  return {
    name: meta.name,
    namespace: meta.namespace ?? 'default',
    workload: ownerName,
    node: pod.spec?.nodeName ?? '',
    phase: status.phase ?? 'Unknown',
    deletionTimestamp: meta.deletionTimestamp ?? null,
    pendingSince,
    startedAt: status.startTime,
    containerStatuses,
  };
}

function statusToView(s: PodStatusLike, now: number): PodView {
  const c = classifyPod(s, now);
  return {
    name: s.name,
    namespace: s.namespace,
    workload: s.workload,
    node: s.node,
    phase: s.phase,
    state: c.state,
    reason: c.reason,
    message: c.message,
    restarts: c.restarts,
    exitCode: c.exitCode,
    startedAt: s.startedAt,
  };
}

function nodeToView(node: any, pods: PodView[]): NodeView {
  const conds: Record<string, boolean> = {};
  let ready = false;
  for (const c of node.status?.conditions ?? []) {
    const val = c.status === 'True';
    if (c.type === 'Ready') ready = val;
    else conds[c.type] = val; // MemoryPressure/DiskPressure/PIDPressure/NetworkUnavailable
  }
  const cpu = { usagePct: 0 };
  const mem = { usagePct: 0 };
  const disk = { usagePct: 0 };
  const net = { ready: conds.NetworkUnavailable !== true };
  const health = deriveNodeHealth({ ready, conditions: conds, cpu, mem, disk, net });
  return {
    name: node.metadata?.name,
    instanceType: node.metadata?.labels?.['node.kubernetes.io/instance-type'],
    ready,
    conditions: conds,
    cpu,
    mem,
    disk,
    net,
    health,
    pods,
  };
}

export class KubeProvider implements ClusterProvider {
  private core: ReadOnlyCoreApi;
  private watcher?: ReadOnlyWatch;
  private cbs: ((nodes: NodeView[]) => void)[] = [];
  private aborts: { abort(): void }[] = [];

  constructor(opts: KubeProviderOptions = {}) {
    if (!opts.core) {
      throw new Error('KubeProvider requires a client; use KubeProvider.createReal() at runtime');
    }
    this.core = opts.core;
    this.watcher = opts.watch;
  }

  /** Build a KubeProvider bound to the real cluster. In-cluster (the Model A deployment) it uses
   *  the pod's ServiceAccount token directly; otherwise it falls back to the default kubeconfig
   *  chain (dev / out-of-cluster). Either way it only ever issues read verbs. */
  static async createReal(): Promise<KubeProvider> {
    const k8s = await import('@kubernetes/client-node');
    const kc = new k8s.KubeConfig();
    if (process.env.KUBERNETES_SERVICE_HOST) {
      kc.loadFromCluster(); // running in a pod: read-only ServiceAccount token + in-cluster CA
    } else {
      kc.loadFromDefault();
    }
    const core = kc.makeApiClient(k8s.CoreV1Api) as unknown as ReadOnlyCoreApi;
    const watch = new k8s.Watch(kc) as unknown as ReadOnlyWatch;
    return new KubeProvider({ core, watch });
  }

  onChange(cb: (nodes: NodeView[]) => void): void {
    this.cbs.push(cb);
  }

  private async snapshot(): Promise<NodeView[]> {
    const now = Date.now();
    const [nodeRes, podRes] = await Promise.all([
      this.core.listNode(),
      this.core.listPodForAllNamespaces(),
    ]);
    const podsByNode = new Map<string, PodView[]>();
    for (const p of items(podRes)) {
      const view = statusToView(podToStatus(p), now);
      const list = podsByNode.get(view.node) ?? [];
      list.push(view);
      podsByNode.set(view.node, list);
    }
    return items(nodeRes).map((n: any) => nodeToView(n, podsByNode.get(n.metadata?.name) ?? []));
  }

  async getNodes(): Promise<NodeView[]> {
    return this.snapshot();
  }

  async getNode(name: string): Promise<NodeView | null> {
    const nodes = await this.snapshot();
    return nodes.find((n) => n.name === name) ?? null;
  }

  async getPodDetail(ns: string, name: string): Promise<PodDetail | null> {
    const podRes = await this.core.listPodForAllNamespaces();
    const raw = items(podRes).find(
      (p: any) => p.metadata?.namespace === ns && p.metadata?.name === name,
    );
    if (!raw) return null;
    const status = podToStatus(raw);
    const now = Date.now();

    const [curLog, prevLog, eventRes] = await Promise.all([
      this.core.readNamespacedPodLog({ namespace: ns, name, tailLines: 500 }).catch(() => ''),
      this.core.readNamespacedPodLog({ namespace: ns, name, previous: true }).catch(() => ''),
      this.core.listNamespacedEvent({ namespace: ns }).catch(() => ({ items: [] })),
    ]);

    const events: PodEvent[] = items(eventRes)
      .filter((e: any) => e.involvedObject?.name === name)
      .map((e: any) => ({
        type: e.type ?? 'Normal',
        reason: e.reason ?? '',
        message: e.message ?? '',
        at: e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp ?? '',
      }));

    const prevLines = String(prevLog || '').split('\n').filter(Boolean);
    return {
      pod: statusToView(status, now),
      crash: extractCrash(status, prevLines),
      events,
      logs: highlightAll(String(curLog || '').split('\n').filter(Boolean)),
    };
  }

  streamPodLogs(ns: string, name: string, cb: (line: string) => void): () => void {
    // Append-only live tail: prime `lastSeen` with the current tail on the first poll WITHOUT
    // emitting it (getPodDetail already returned those lines), then stream only new lines.
    let lastSeen: string | null = null;
    let stopped = false;
    const poll = async (): Promise<void> => {
      if (stopped) return;
      try {
        const log = String((await this.core.readNamespacedPodLog({ namespace: ns, name, tailLines: 100 })) || '');
        if (lastSeen === null) {
          lastSeen = log; // prime, do not emit the existing tail
        } else if (log !== lastSeen) {
          for (const line of log.slice(lastSeen.length).split('\n').filter(Boolean)) cb(line);
          lastSeen = log;
        }
      } catch {
        // transient read error — ignore, keep polling
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  /** Begin watching nodes + pods (read-only) and push updates. */
  async start(): Promise<void> {
    // prime
    const nodes = await this.snapshot();
    for (const cb of this.cbs) cb(nodes);

    if (!this.watcher) return;
    const refresh = async (): Promise<void> => {
      const ns = await this.snapshot();
      for (const cb of this.cbs) cb(ns);
    };
    for (const path of ['/api/v1/pods', '/api/v1/nodes']) {
      const a = await this.watcher.watch(
        path,
        {},
        () => void refresh(),
        () => {
          /* watch closed/error — ignore for POC */
        },
      );
      this.aborts.push(a);
    }
  }

  stop(): void {
    for (const a of this.aborts) a.abort();
    this.aborts = [];
  }
}
