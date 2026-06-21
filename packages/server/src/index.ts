// Server entrypoint. Selects a provider via env, wires the clock + timeline, and listens.
//   TESSERA_PROVIDER    = mock (default) | kube
//   TESSERA_FIXTURE     = (canonical, default) | big
//   TESSERA_TEST_HOOKS  = 1  -> ManualClock + GET /api/_test/advance, no auto timeline
//   TESSERA_SERVE_WEB   = 1  -> serve packages/web/dist (single origin)
//   TESSERA_DEV_TIMELINE = 1 -> real-time looping timeline (used by `npm run dev`)

import { buildServer } from './app';
import { buildCanonicalFixture, buildBigFixture, TIMELINE_OFFSETS } from './providers/fixtures';
import { MockProvider } from './providers/mockProvider';
import { ManualClock, RealClock, type Clock, type ClusterProvider } from './providers/provider';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const useTestHooks = process.env.TESSERA_TEST_HOOKS === '1';
const serveWeb = process.env.TESSERA_SERVE_WEB === '1';
const devTimeline = process.env.TESSERA_DEV_TIMELINE === '1';
const providerKind = process.env.TESSERA_PROVIDER ?? 'mock';

const FIXED_EPOCH = Date.UTC(2026, 5, 20, 11, 5, 0);

async function main(): Promise<void> {
  let provider: ClusterProvider;
  let clock: Clock;
  let cluster = 'cluster';
  let cellId = 'cluster';
  let mock: MockProvider | undefined;

  if (providerKind === 'kube') {
    const { KubeProvider } = await import('./providers/kubeProvider');
    clock = new RealClock();
    const kube = await KubeProvider.createReal();
    await kube.start();
    provider = kube;
    cluster = process.env.TESSERA_CLUSTER ?? 'kube-cluster';
    cellId = cluster;
  } else {
    clock = useTestHooks ? new ManualClock(FIXED_EPOCH) : new RealClock();
    const fixture =
      process.env.TESSERA_FIXTURE === 'big' ? buildBigFixture() : buildCanonicalFixture();
    cluster = fixture.cluster;
    cellId = fixture.cellId;
    mock = new MockProvider({ fixture, clock });
    provider = mock;
  }

  const server = buildServer({
    provider,
    clock,
    cluster,
    cellId,
    serveWeb,
    enableTestHooks: useTestHooks,
    logger: false,
  });

  // Seed t0 (handlers are registered synchronously by buildServer).
  if (mock) mock.start();

  // Dev-only real-time timeline loop (t0->t1->t2->t3, then repeat).
  if (mock && devTimeline && !useTestHooks) {
    const loop = (): void => {
      mock!.setTimelineLabel('t1');
      setTimeout(() => mock!.setTimelineLabel('t2'), TIMELINE_OFFSETS.t2 - TIMELINE_OFFSETS.t1);
      setTimeout(() => mock!.setTimelineLabel('t3'), TIMELINE_OFFSETS.t3 - TIMELINE_OFFSETS.t1);
      setTimeout(() => {
        mock!.setTimelineLabel('t0');
        setTimeout(loop, 8_000);
      }, TIMELINE_OFFSETS.t3 - TIMELINE_OFFSETS.t1 + 8_000);
    };
    setTimeout(loop, TIMELINE_OFFSETS.t1);
  }

  await server.app.listen({ port: PORT, host: HOST });
  console.log(
    `[tessera] server on http://localhost:${PORT}  provider=${providerKind}` +
      `${useTestHooks ? ' (test-hooks)' : ''}${serveWeb ? ' (serving web)' : ''}`,
  );
}

main().catch((err) => {
  console.error('[tessera] fatal', err);
  process.exit(1);
});
