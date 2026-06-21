import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type HexwallServer } from './app';
import { buildCanonicalFixture } from './providers/fixtures';
import { MockProvider } from './providers/mockProvider';
import { ManualClock } from './providers/provider';
import {
  CellSchema,
  ClusterSnapshotSchema,
  HealthyNodesSchema,
  NodeViewSchema,
  PodDetailSchema,
} from './schemas';

const FIXED_EPOCH = Date.UTC(2026, 5, 20, 11, 5, 0);

function makeServer(): { server: HexwallServer; mock: MockProvider; clock: ManualClock } {
  const clock = new ManualClock(FIXED_EPOCH);
  const fixture = buildCanonicalFixture();
  const mock = new MockProvider({ fixture, clock });
  const server = buildServer({
    provider: mock,
    clock,
    cluster: fixture.cluster,
    cellId: fixture.cellId,
    enableTestHooks: true,
  });
  mock.start(); // seed t0
  return { server, mock, clock };
}

let disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
});

async function json(server: HexwallServer, url: string) {
  const res = await server.app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
}

describe('GET /api/snapshot', () => {
  it('matches the schema; 48 folded; 5 boxes; §6 sort order', async () => {
    const { server } = makeServer();
    const { status, body } = await json(server, '/api/snapshot');
    expect(status).toBe(200);
    const snap = ClusterSnapshotSchema.parse(body);
    expect(snap.cluster).toBe('prod-eks-use1');
    expect(snap.cellId).toBe('aws/123456789012/eks/prod-eks-use1');
    expect(snap.healthyFolded).toBe(48);
    expect(snap.boxes.length).toBe(5);
    expect(snap.totals.nodes).toBe(53);
    expect(snap.boxes.map((b) => b.id)).toEqual([
      'ip-10-0-9-12',
      'ip-10-0-4-91',
      'ip-10-0-7-30',
      'ip-10-0-2-45',
      'ip-10-0-3-08',
    ]);
  });

  it('the four meaningful border/hex combinations are all present', async () => {
    const { server } = makeServer();
    const { body } = await json(server, '/api/snapshot');
    const snap = ClusterSnapshotSchema.parse(body);
    const by = Object.fromEntries(snap.boxes.map((b) => [b.id, b]));
    // neutral border + red hexes (app broken)
    expect(by['ip-10-0-2-45'].nodeHealth).toBe('ok');
    expect(by['ip-10-0-2-45'].litSeverity).toBe('crit');
    expect(by['ip-10-0-2-45'].litHexes).toBe(1);
    // crit border + green hexes (infra early warning)
    expect(by['ip-10-0-9-12'].nodeHealth).toBe('crit');
    expect(by['ip-10-0-9-12'].litHexes).toBe(0);
    // warn border + red hexes (both unhappy)
    expect(by['ip-10-0-4-91'].nodeHealth).toBe('warn');
    expect(by['ip-10-0-4-91'].litSeverity).toBe('crit');
    // neutral border + amber hexes (minor degradation)
    expect(by['ip-10-0-3-08'].nodeHealth).toBe('ok');
    expect(by['ip-10-0-3-08'].litSeverity).toBe('warn');
    // widespread
    expect(by['ip-10-0-7-30'].litHexes).toBe(3);
  });
});

describe('GET /api/node/:name', () => {
  it('ip-10-0-7-30 returns 20 pods, 12 crit', async () => {
    const { server } = makeServer();
    const { status, body } = await json(server, '/api/node/ip-10-0-7-30');
    expect(status).toBe(200);
    const node = NodeViewSchema.parse(body);
    expect(node.pods.length).toBe(20);
    expect(node.pods.filter((p) => p.state === 'crit').length).toBe(12);
  });

  it('ip-10-0-4-91 returns 17 pods, 3 crit', async () => {
    const { server } = makeServer();
    const node = NodeViewSchema.parse((await json(server, '/api/node/ip-10-0-4-91')).body);
    expect(node.pods.length).toBe(17);
    expect(node.pods.filter((p) => p.state === 'crit').length).toBe(3);
  });

  it('unknown node → 404', async () => {
    const { server } = makeServer();
    expect((await json(server, '/api/node/nope')).status).toBe(404);
  });
});

describe('GET /api/pod/:ns/:name', () => {
  it('crashing pod has populated crash (CrashLoopBackOff / 137) and highlighted previousLogs', async () => {
    const { server } = makeServer();
    const { status, body } = await json(
      server,
      '/api/pod/payments/payments-api-7f9c8b6d4-q2x9z',
    );
    expect(status).toBe(200);
    const detail = PodDetailSchema.parse(body);
    expect(detail.crash).toBeDefined();
    expect(detail.crash!.reason).toBe('CrashLoopBackOff');
    expect(detail.crash!.exitCode).toBe(137);
    const critSpans = detail.crash!.previousLogs.flatMap((l) => l.spans).filter((s) => s.kind === 'crit');
    expect(critSpans.length).toBeGreaterThan(0);
    // events include BackOff + liveness
    expect(detail.events.some((e) => e.reason === 'BackOff')).toBe(true);
    expect(detail.events.some((e) => e.reason === 'Unhealthy')).toBe(true);
  });

  it('healthy pod has no crash block', async () => {
    const { server } = makeServer();
    const detail = PodDetailSchema.parse(
      (await json(server, '/api/pod/web/web-ip-10-0-2-45-0')).body,
    );
    expect(detail.crash).toBeUndefined();
    expect(detail.logs.flatMap((l) => l.spans).every((s) => s.kind !== 'crit')).toBe(true);
  });

  it('unknown pod → 404', async () => {
    const { server } = makeServer();
    expect((await json(server, '/api/pod/none/none')).status).toBe(404);
  });
});

describe('GET /api/healthy', () => {
  it('returns the 48 folded healthy nodes', async () => {
    const { server } = makeServer();
    const { status, body } = await json(server, '/api/healthy');
    expect(status).toBe(200);
    const parsed = HealthyNodesSchema.parse(body);
    expect(parsed.nodes.length).toBe(48);
    expect(parsed.nodes.every((n) => n.health === 'ok')).toBe(true);
  });
});

describe('GET /api/cell/:id — Cell tree (PLATFORM_MODEL §6)', () => {
  it('returns a Cell with renderKey eks-cluster for the canonical cluster id', async () => {
    const { server } = makeServer();
    const { status, body } = await json(server, '/api/cell/aws/123456789012/eks/prod-eks-use1');
    expect(status).toBe(200);
    const cell = CellSchema.parse(body);
    expect(cell.renderKey).toBe('eks-cluster');
    expect(cell.level).toBe('resource');
    expect(cell.kind).toBe('eks');
    expect(cell.rollup.total).toBeGreaterThan(0);
    expect(cell.rollup.severity).toBeTruthy();
  });

  it('returns 404 for an unknown cell id', async () => {
    const { server } = makeServer();
    expect((await json(server, '/api/cell/aws/123456789012/eks/unknown')).status).toBe(404);
  });
});

describe('timeline (drives the engine through advanceTo)', () => {
  it('healthyFolded goes 48 → 47 → 47 → 48 and ip-10-0-6-77 appears then folds', async () => {
    const { server, mock } = makeServer();
    const ids = () =>
      ClusterSnapshotSchema.parse(server.currentSnapshot()).boxes.map((b) => b.id);

    expect(server.currentSnapshot().healthyFolded).toBe(48);
    expect(ids()).not.toContain('ip-10-0-6-77');

    mock.advanceTo('t1');
    expect(server.currentSnapshot().healthyFolded).toBe(47);
    expect(ids()).toContain('ip-10-0-6-77');

    mock.advanceTo('t2');
    expect(server.currentSnapshot().healthyFolded).toBe(47);
    expect(ids()).toContain('ip-10-0-6-77'); // still visible (hysteresis)

    mock.advanceTo('t3');
    expect(server.currentSnapshot().healthyFolded).toBe(48);
    expect(ids()).not.toContain('ip-10-0-6-77'); // folded back
  });

  it('the /api/_test/advance hook drives the same transition', async () => {
    const { server } = makeServer();
    expect((await json(server, '/api/_test/advance?to=t1')).status).toBe(200);
    expect(server.currentSnapshot().healthyFolded).toBe(47);
    expect((await json(server, '/api/_test/advance?to=bogus')).status).toBe(400);
  });
});
