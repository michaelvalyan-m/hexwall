// Fastify app builder. All cluster routes are READ-ONLY (FUNCTIONAL_SPEC §9): only GET routes
// touch cluster data; no POST/PUT/PATCH/DELETE is ever registered. `getRoutes()` exposes the
// route table so the read-only guard test can assert this.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  RollupEngine,
  boxToCell,
  buildResourceCell,
  computeBox,
  type Cell,
  type ClusterSnapshot,
  type NodeView,
} from '@tessera/shared';
import type { Clock, ClusterProvider } from './providers/provider';
import type { MockProvider } from './providers/mockProvider';
import type { TimelineLabel } from './providers/fixtures';

export interface BuildServerOptions {
  provider: ClusterProvider;
  clock: Clock;
  cluster?: string;
  cellId?: string; // global path id (PLATFORM_MODEL §6); defaults to cluster
  serveWeb?: boolean;
  enableTestHooks?: boolean;
  logger?: boolean;
}

export interface HexwallServer {
  app: FastifyInstance;
  engine: RollupEngine;
  getRoutes(): { method: string; url: string }[];
  currentSnapshot(): ClusterSnapshot;
}

const TIMELINE_LABELS: TimelineLabel[] = ['t0', 't1', 't2', 't3'];

function sseHeaders(reply: { raw: import('node:http').ServerResponse }): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function buildServer(opts: BuildServerOptions): HexwallServer {
  const { provider, clock } = opts;
  const cluster = opts.cluster ?? 'cluster';
  const cellId = opts.cellId ?? cluster;
  const app = Fastify({ logger: opts.logger ?? false, forceCloseConnections: true });

  const engine = new RollupEngine();
  const routes: { method: string; url: string }[] = [];
  app.addHook('onRoute', (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) routes.push({ method: m, url: r.url });
  });

  let latestNodes: NodeView[] = [];
  // Do NOT seed the engine here — the first real computeSnapshot (from the provider's initial
  // emit) must be the one that seeds it, so initial-eligible nodes fold immediately (DECISIONS D3).
  let latestSnapshot: ClusterSnapshot = {
    cluster,
    cellId,
    generatedAt: clock.now(),
    boxes: [],
    healthyFolded: 0,
    totals: { nodes: 0, pods: 0, nodesCrit: 0, nodesWarn: 0 },
  };

  const snapshotSubs = new Set<(s: ClusterSnapshot) => void>();

  provider.onChange((nodes) => {
    latestNodes = nodes;
    latestSnapshot = engine.computeSnapshot(nodes, clock.now(), cluster, cellId);
    for (const sub of snapshotSubs) sub(latestSnapshot);
  });

  // ---- server health (allowed; not a cluster route) ----
  app.get('/health', async () => ({ status: 'ok', provider: 'ready' }));

  // ---- REST (read-only) ----
  app.get('/api/snapshot', async () => latestSnapshot);

  app.get('/api/healthy', async () => {
    const folded = engine.getFoldedIds();
    return { nodes: latestNodes.filter((n) => folded.has(n.name)) };
  });

  app.get<{ Params: { name: string } }>('/api/node/:name', async (req, reply) => {
    const node = await provider.getNode(req.params.name);
    if (!node) return reply.code(404).send({ error: 'node not found' });
    return node;
  });

  app.get<{ Params: { ns: string; name: string } }>('/api/pod/:ns/:name', async (req, reply) => {
    const detail = await provider.getPodDetail(req.params.ns, req.params.name);
    if (!detail) return reply.code(404).send({ error: 'pod not found' });
    return detail;
  });

  // ---- Cell tree (PLATFORM_MODEL §6) — GET /api/cell/<global-path-id> ----
  // Returns the Cell for the given id. For the EKS resource cell, includes node children.
  // Higher-level stubs (service, account, provider, estate) are built on-the-fly from the
  // current snapshot so they always reflect live state.
  app.get<{ Params: { '*': string } }>('/api/cell/*', async (req, reply) => {
    const id = (req.params as Record<string, string>)['*'];

    if (id === cellId) {
      // EKS resource cell: build from the engine's current processed state so changedAt,
      // sort order, and fold state are all consistent with the live snapshot.
      const foldedIds = engine.getFoldedIds();
      const foldedCells: Cell[] = latestNodes
        .filter((n) => foldedIds.has(n.name))
        .map((n) => boxToCell(computeBox(n), cellId));
      const visibleCells: Cell[] = latestSnapshot.boxes.map((b) => boxToCell(b, cellId));
      return buildResourceCell(cellId, cluster, [...visibleCells, ...foldedCells], latestSnapshot.generatedAt);
    }

    return reply.code(404).send({ error: 'cell not found', id });
  });

  // ---- SSE: live cluster snapshots ----
  app.get('/api/stream', (req, reply) => {
    sseHeaders(reply);
    const send = (s: ClusterSnapshot) => {
      reply.raw.write(`event: snapshot\ndata: ${JSON.stringify(s)}\n\n`);
    };
    send(latestSnapshot); // prime the stream
    snapshotSubs.add(send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      snapshotSubs.delete(send);
    });
  });

  // ---- SSE: on-demand pod log stream ----
  app.get<{ Params: { ns: string; name: string } }>('/api/pod/:ns/:name/logs', (req, reply) => {
    sseHeaders(reply);
    const unsub = provider.streamPodLogs(req.params.ns, req.params.name, (line) => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`);
    });
    req.raw.on('close', () => unsub());
  });

  // ---- Test-only hooks (env-gated). GET only — keeps the route guard trivially strong. ----
  if (opts.enableTestHooks) {
    app.get<{ Querystring: { to?: string } }>('/api/_test/advance', async (req, reply) => {
      const to = req.query.to as TimelineLabel;
      if (!TIMELINE_LABELS.includes(to)) {
        return reply.code(400).send({ error: 'bad label', valid: TIMELINE_LABELS });
      }
      const mock = provider as unknown as MockProvider;
      if (typeof mock.advanceTo !== 'function') {
        return reply.code(409).send({ error: 'provider has no timeline' });
      }
      mock.advanceTo(to);
      return { ok: true, label: to, generatedAt: latestSnapshot.generatedAt };
    });

    // Reset to a clean t0 (fresh fold state) — used by e2e beforeEach for test isolation.
    app.get('/api/_test/reset', async () => {
      const mock = provider as unknown as MockProvider;
      engine.reset();
      if (typeof mock.advanceTo === 'function') mock.advanceTo('t0');
      return { ok: true, healthyFolded: latestSnapshot.healthyFolded };
    });
  }

  // ---- Static web (env-gated; single-origin for e2e) ----
  if (opts.serveWeb) {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(here, '../../web/dist'), // from packages/server/src or dist
      join(here, '../web/dist'),
    ];
    const webRoot = candidates.find((p) => existsSync(join(p, 'index.html')));
    if (webRoot) {
      app.register(fastifyStatic, { root: webRoot, prefix: '/' });
      app.setNotFoundHandler((req, reply) => {
        if (req.url.startsWith('/api') || req.url.startsWith('/health')) {
          return reply.code(404).send({ error: 'not found' });
        }
        return reply.sendFile('index.html');
      });
    }
  }

  return {
    app,
    engine,
    getRoutes: () => routes.slice(),
    currentSnapshot: () => latestSnapshot,
  };
}
