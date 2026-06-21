// MockProvider — plays the deterministic canonical fixture + the scripted timeline
// (MOCK_SCENARIOS §1–§3). Read-only; no mutation method exists.

import { extractCrash, highlightAll, type NodeView, type PodDetail } from '@tessera/shared';
import {
  buildBigFixture,
  buildCanonicalFixture,
  SIX77,
  six77Pods,
  TIMELINE_OFFSETS,
  type Fixture,
  type TimelineLabel,
} from './fixtures';
import { ManualClock, RealClock, type Clock, type ClusterProvider } from './provider';

export interface MockProviderOptions {
  fixture?: Fixture;
  clock?: Clock;
}

export class MockProvider implements ClusterProvider {
  readonly clock: Clock;
  private fixture: Fixture;
  private cbs: ((nodes: NodeView[]) => void)[] = [];
  private timelineStart: number;
  private label: TimelineLabel = 't0';
  private logTimers = new Set<ReturnType<typeof setInterval>>();

  constructor(opts: MockProviderOptions = {}) {
    this.fixture = opts.fixture ?? buildCanonicalFixture();
    this.clock = opts.clock ?? new RealClock();
    this.timelineStart = this.clock.now();
  }

  onChange(cb: (nodes: NodeView[]) => void): void {
    this.cbs.push(cb);
  }

  private emit(): void {
    for (const cb of this.cbs) cb(this.fixture.nodes);
  }

  /** Emit the initial (t0) state. */
  start(): void {
    this.emit();
  }

  async getNodes(): Promise<NodeView[]> {
    return this.fixture.nodes;
  }

  async getNode(name: string): Promise<NodeView | null> {
    return this.fixture.nodes.find((n) => n.name === name) ?? null;
  }

  async getPodDetail(ns: string, name: string): Promise<PodDetail | null> {
    const rec = this.fixture.records.get(`${ns}/${name}`);
    if (!rec) return null;
    return {
      pod: rec.view,
      crash: extractCrash(rec.status, rec.prevLogs),
      events: rec.events,
      logs: highlightAll(rec.logs),
    };
  }

  streamPodLogs(_ns: string, name: string, cb: (line: string) => void): () => void {
    // The SSE stream is the *live tail*: it emits only NEW lines to be appended to the current
    // logs already returned by getPodDetail — it must NOT replay those (that would double them).
    let n = 0;
    const timer = setInterval(() => {
      n++;
      const ss = String(n % 60).padStart(2, '0');
      cb(`2026-06-20T11:06:${ss}Z INFO  heartbeat (${name}) status=200`);
    }, 250);
    this.logTimers.add(timer);
    return () => {
      clearInterval(timer);
      this.logTimers.delete(timer);
    };
  }

  // ---- Timeline control (MOCK_SCENARIOS §3) ----

  /** Mutate ip-10-0-6-77's pods for `label` and emit (does NOT touch the clock). */
  setTimelineLabel(label: TimelineLabel): void {
    this.label = label;
    const node = this.fixture.nodes.find((n) => n.name === SIX77);
    if (node) node.pods = six77Pods(label, this.fixture.records);
    this.emit();
  }

  /** Set the (manual) clock to the label's offset and apply the label. Test/e2e entry point. */
  advanceTo(label: TimelineLabel): void {
    if (this.clock instanceof ManualClock) {
      this.clock.set(this.timelineStart + TIMELINE_OFFSETS[label]);
    }
    this.setTimelineLabel(label);
  }

  currentLabel(): TimelineLabel {
    return this.label;
  }

  dispose(): void {
    for (const t of this.logTimers) clearInterval(t);
    this.logTimers.clear();
  }
}

export function buildMockProvider(opts: MockProviderOptions = {}): MockProvider {
  return new MockProvider(opts);
}

export { buildBigFixture };
