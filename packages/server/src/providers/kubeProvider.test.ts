// KubeProvider read-only proof (FUNCTIONAL_SPEC §9 / TEST_PLAN §3): wrap the K8s client in a
// recording proxy and assert that across a full simulated session ONLY read verbs
// (list/read/watch) are ever invoked — never create/patch/replace/delete.

import { describe, expect, it, vi } from 'vitest';
import { KubeProvider, type ReadOnlyCoreApi, type ReadOnlyWatch } from './kubeProvider';

const fakeNode = {
  metadata: { name: 'ip-10-0-0-1', labels: { 'node.kubernetes.io/instance-type': 'm5.large' } },
  status: {
    conditions: [
      { type: 'Ready', status: 'True' },
      { type: 'MemoryPressure', status: 'False' },
      { type: 'DiskPressure', status: 'False' },
    ],
  },
};

const fakePod = {
  metadata: { name: 'web-abc', namespace: 'web', ownerReferences: [{ name: 'web' }] },
  spec: { nodeName: 'ip-10-0-0-1' },
  status: {
    phase: 'Running',
    startTime: '2026-06-20T10:00:00Z',
    containerStatuses: [{ name: 'web', ready: true, restartCount: 0, state: { running: {} } }],
  },
};

const crashingPod = {
  metadata: { name: 'payments-x', namespace: 'payments', ownerReferences: [{ name: 'payments' }] },
  spec: { nodeName: 'ip-10-0-0-1' },
  status: {
    phase: 'Running',
    containerStatuses: [
      {
        name: 'payments',
        ready: false,
        restartCount: 8,
        state: { waiting: { reason: 'CrashLoopBackOff' } },
        lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
      },
    ],
  },
};

const fakeEvent = {
  type: 'Warning',
  reason: 'BackOff',
  message: 'Back-off restarting failed container',
  lastTimestamp: '2026-06-20T11:03:10Z',
  involvedObject: { name: 'payments-x' },
};

/** Records every property name read off the wrapped object. */
function recordingProxy<T extends object>(target: T, log: string[]): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === 'string') log.push(prop);
      return Reflect.get(t, prop, recv);
    },
  });
}

function makeCore(log: string[]): ReadOnlyCoreApi {
  const base: ReadOnlyCoreApi = {
    listNode: vi.fn(async () => ({ items: [fakeNode] })),
    listPodForAllNamespaces: vi.fn(async () => ({ items: [fakePod, crashingPod] })),
    listNamespacedEvent: vi.fn(async () => ({ items: [fakeEvent] })),
    readNamespacedPodLog: vi.fn(async () => '2026 INFO line one\n2026 ERROR boom 500'),
  };
  return recordingProxy(base, log);
}

function makeWatch(log: string[]): ReadOnlyWatch {
  const base: ReadOnlyWatch = {
    watch: vi.fn(async () => ({ abort: () => {} })),
  };
  return recordingProxy(base, log);
}

const WRITE_PREFIXES = ['create', 'patch', 'replace', 'delete', 'put', 'post', 'connect', 'apply'];

describe('KubeProvider — read-only across a full session', () => {
  it('only read verbs are accessed; node/pod/crash data maps correctly', async () => {
    const log: string[] = [];
    const provider = new KubeProvider({ core: makeCore(log), watch: makeWatch(log) });

    provider.onChange(() => {});
    await provider.start();

    const nodes = await provider.getNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('ip-10-0-0-1');
    expect(nodes[0].pods.length).toBe(2);

    const node = await provider.getNode('ip-10-0-0-1');
    expect(node).not.toBeNull();

    const detail = await provider.getPodDetail('payments', 'payments-x');
    expect(detail).not.toBeNull();
    expect(detail!.crash?.reason).toBe('CrashLoopBackOff');
    expect(detail!.crash?.exitCode).toBe(137);
    expect(detail!.events.some((e) => e.reason === 'BackOff')).toBe(true);
    // current logs highlighted (500 -> crit)
    expect(detail!.logs.flatMap((l) => l.spans).some((s) => s.kind === 'crit')).toBe(true);

    const unsub = provider.streamPodLogs('payments', 'payments-x', () => {});
    unsub();
    provider.stop();

    // Assertions: a read verb was used, and NO write verb was ever accessed.
    const accessed = new Set(log);
    expect(accessed.has('listNode')).toBe(true);
    expect(accessed.has('listPodForAllNamespaces')).toBe(true);
    expect(accessed.has('readNamespacedPodLog')).toBe(true);
    expect(accessed.has('listNamespacedEvent')).toBe(true);
    expect(accessed.has('watch')).toBe(true);

    for (const name of accessed) {
      const lower = name.toLowerCase();
      for (const bad of WRITE_PREFIXES) {
        expect(lower.startsWith(bad), `unexpected write-ish call: ${name}`).toBe(false);
      }
    }
  });
});
