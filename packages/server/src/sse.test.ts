// Faithful SSE test: start a real listening server, subscribe to /api/stream, drive the timeline
// through the test hook, and assert pushed snapshots reflect the change (TEST_PLAN §3 SSE).

import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildServer, type HexwallServer } from './app';
import { buildCanonicalFixture } from './providers/fixtures';
import { MockProvider } from './providers/mockProvider';
import { ManualClock } from './providers/provider';
import type { ClusterSnapshot } from '@tessera/shared';

let current: HexwallServer | undefined;
afterEach(async () => {
  if (current) await current.app.close();
  current = undefined;
});

async function start(): Promise<{ base: string; mock: MockProvider }> {
  const clock = new ManualClock(Date.UTC(2026, 5, 20, 11, 5, 0));
  const mock = new MockProvider({ fixture: buildCanonicalFixture(), clock });
  const server = buildServer({ provider: mock, clock, enableTestHooks: true });
  mock.start();
  current = server;
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.app.server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${addr.port}`, mock };
}

function snapshotReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async function (): Promise<ClusterSnapshot> {
    for (;;) {
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.includes('event: snapshot')) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) return JSON.parse(dataLine.slice(6)) as ClusterSnapshot;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { next, cancel: () => reader.cancel().catch(() => {}) };
}

function eventReader<T>(body: ReadableStream<Uint8Array>, eventName: string) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const next = async function (): Promise<T> {
    for (;;) {
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.includes(`event: ${eventName}`)) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (dataLine) return JSON.parse(dataLine.slice(6)) as T;
        }
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { next, cancel: () => reader.cancel().catch(() => {}) };
}

describe('SSE /api/pod/:ns/:name/logs', () => {
  it('streams live log lines as event: log frames (append-only tail)', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/pod/payments/payments-api-7f9c8b6d4-q2x9z/logs`);
    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const stream = eventReader<{ line: string }>(res.body!, 'log');
    const first = await stream.next();
    expect(typeof first.line).toBe('string');
    expect(first.line.length).toBeGreaterThan(0);
    await stream.cancel();
  });
});

describe('SSE /api/stream', () => {
  it('pushes the primed snapshot and a new one after advancing the timeline', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/stream`);
    expect(res.ok).toBe(true);
    const stream = snapshotReader(res.body!);

    const s0 = await stream.next();
    expect(s0.healthyFolded).toBe(48);
    expect(s0.boxes.map((b) => b.id)).not.toContain('ip-10-0-6-77');

    await fetch(`${base}/api/_test/advance?to=t1`);
    const s1 = await stream.next();
    expect(s1.healthyFolded).toBe(47);
    expect(s1.boxes.map((b) => b.id)).toContain('ip-10-0-6-77');

    await stream.cancel();
  });
});
