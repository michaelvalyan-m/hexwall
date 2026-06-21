// ClusterProvider interface (ARCHITECTURE §6). The interface exposes NO write method — adding
// one is a spec violation (FUNCTIONAL_SPEC §9). All methods are read-only.

import type { NodeView, PodDetail } from '@hexwall/shared';

export interface ClusterProvider {
  /** Push the current cluster state; called on watch events or mock ticks. */
  onChange(cb: (nodes: NodeView[]) => void): void;
  getNodes(): Promise<NodeView[]>;
  getNode(name: string): Promise<NodeView | null>;
  getPodDetail(ns: string, name: string): Promise<PodDetail | null>;
  /** Returns an unsubscribe function. */
  streamPodLogs(ns: string, name: string, cb: (line: string) => void): () => void;
}

/** Deterministic clock abstraction so the engine + mock timeline are testable. */
export interface Clock {
  now(): number;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements Clock {
  private t: number;
  constructor(start: number) {
    this.t = start;
  }
  now(): number {
    return this.t;
  }
  set(t: number): void {
    this.t = t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
