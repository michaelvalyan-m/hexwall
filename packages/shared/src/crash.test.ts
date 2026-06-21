import { describe, expect, it } from 'vitest';
import { extractCrash } from './crash';
import type { LogLine, PodStatusLike } from './types';

const PREV_LOGS = [
  '2026-06-20T11:02:13Z INFO  starting payments-api v1.8.2',
  '2026-06-20T11:02:14Z INFO  connected to postgres',
  '2026-06-20T11:03:01Z ERROR upstream returned 503 from inventory-svc',
  '2026-06-20T11:03:01Z WARN  retrying request (attempt 2) ... timeout',
  '2026-06-20T11:03:09Z ERROR unhandled exception in worker pool',
  '2026-06-20T11:03:09Z panic: runtime: out of memory',
  '2026-06-20T11:03:09Z signal: killed (exit code 137 / OOMKilled)',
];

const crashingPod: PodStatusLike = {
  name: 'payments-api-7f9c8b6d4-q2x9z',
  namespace: 'payments',
  workload: 'payments-api',
  node: 'ip-10-0-4-91',
  phase: 'Running',
  containerStatuses: [
    {
      name: 'payments-api',
      ready: false,
      restartCount: 8,
      state: { waiting: { reason: 'CrashLoopBackOff' } },
      lastState: { terminated: { reason: 'OOMKilled', exitCode: 137, message: 'Container killed' } },
    },
  ],
};

const healthyPod: PodStatusLike = {
  name: 'web-1',
  namespace: 'web',
  workload: 'web',
  node: 'ip-10-0-2-45',
  phase: 'Running',
  containerStatuses: [{ name: 'web', ready: true, restartCount: 0, state: { running: {} } }],
};

function flatKinds(lines: LogLine[]): Set<string> {
  const s = new Set<string>();
  for (const l of lines) for (const sp of l.spans) s.add(sp.kind);
  return s;
}
function lineWith(lines: LogLine[], needle: string): LogLine | undefined {
  return lines.find((l) => l.raw.includes(needle));
}

describe('extractCrash — crashing pod', () => {
  const crash = extractCrash(crashingPod, PREV_LOGS)!;

  it('reason is the waiting reason, exitCode from lastState.terminated', () => {
    expect(crash).toBeDefined();
    expect(crash.reason).toBe('CrashLoopBackOff');
    expect(crash.exitCode).toBe(137);
    expect(crash.message).toBe('Container killed');
  });

  it('previousLogs are present and highlighted', () => {
    expect(crash.previousLogs.length).toBe(PREV_LOGS.length);
    expect(flatKinds(crash.previousLogs).has('crit')).toBe(true);
    expect(flatKinds(crash.previousLogs).has('warn')).toBe(true);
  });

  it('the documented tokens are highlighted in the right lines', () => {
    const l503 = lineWith(crash.previousLogs, '503')!;
    expect(l503.spans.some((s) => s.text === '503' && s.kind === 'crit')).toBe(true);
    expect(l503.spans.some((s) => s.text === 'ERROR' && s.kind === 'warn')).toBe(true);

    const lpanic = lineWith(crash.previousLogs, 'panic')!;
    expect(lpanic.spans.some((s) => s.kind === 'crit')).toBe(true);

    const lsig = lineWith(crash.previousLogs, 'signal: killed')!;
    expect(lsig.spans.some((s) => s.text.includes('OOMKilled') && s.kind === 'crit')).toBe(true);
    expect(lsig.spans.some((s) => s.kind === 'crit')).toBe(true);

    const lretry = lineWith(crash.previousLogs, 'retrying')!;
    expect(lretry.spans.some((s) => s.kind === 'warn')).toBe(true);
  });
});

describe('extractCrash — healthy pod', () => {
  it('returns undefined (no crash block)', () => {
    expect(extractCrash(healthyPod, [])).toBeUndefined();
  });

  it('a benign Completed/exit-0 lastState does NOT produce a crash block (§8 regression)', () => {
    const benign: PodStatusLike = {
      name: 'web-1',
      namespace: 'web',
      workload: 'web',
      node: 'n1',
      phase: 'Running',
      containerStatuses: [
        {
          name: 'web',
          ready: true,
          restartCount: 0,
          state: { running: { startedAt: '2026-06-20T10:00:00Z' } },
          lastState: { terminated: { reason: 'Completed', exitCode: 0 } },
        },
      ],
    };
    expect(extractCrash(benign, [])).toBeUndefined();
  });

  it('an abnormal current state.terminated (Error/exit 1) yields a crash', () => {
    const failedNow: PodStatusLike = {
      name: 'one-shot',
      namespace: 'jobs',
      workload: 'one-shot',
      node: 'n1',
      phase: 'Running',
      containerStatuses: [
        { name: 'one-shot', ready: false, restartCount: 0, state: { terminated: { reason: 'Error', exitCode: 1 } } },
      ],
    };
    const crash = extractCrash(failedNow, ['boom 500']);
    expect(crash?.reason).toBe('Error');
    expect(crash?.exitCode).toBe(1);
    expect(crash?.previousLogs[0].spans.some((s) => s.kind === 'crit')).toBe(true);
  });

  it('a terminated reason without an exit code (e.g. ContainerCannotRun) is still a crash', () => {
    const pod: PodStatusLike = {
      name: 'x',
      namespace: 'ns',
      workload: 'x',
      node: 'n1',
      phase: 'Running',
      containerStatuses: [
        { name: 'x', ready: false, restartCount: 1, lastState: { terminated: { reason: 'ContainerCannotRun' } } },
      ],
    };
    expect(extractCrash(pod, [])?.reason).toBe('ContainerCannotRun');
  });

  it('a pod with no container statuses → undefined', () => {
    const pod: PodStatusLike = {
      name: 'x',
      namespace: 'ns',
      workload: 'x',
      node: 'n1',
      phase: 'Pending',
      containerStatuses: [],
    };
    expect(extractCrash(pod, [])).toBeUndefined();
  });

  it('an abnormal lastState (Error/exit 1) without a waiting reason still yields a crash', () => {
    const recentlyCrashed: PodStatusLike = {
      name: 'job-1',
      namespace: 'jobs',
      workload: 'job',
      node: 'n1',
      phase: 'Running',
      containerStatuses: [
        { name: 'job', ready: true, restartCount: 2, lastState: { terminated: { reason: 'Error', exitCode: 1 } } },
      ],
    };
    const crash = extractCrash(recentlyCrashed, []);
    expect(crash?.reason).toBe('Error');
    expect(crash?.exitCode).toBe(1);
  });
});
