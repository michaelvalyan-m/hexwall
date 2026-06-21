// REST + SSE client. Same-origin (server serves the web in prod/e2e; Vite proxies /api in dev).

import type { ClusterSnapshot, NodeView, PodDetail } from '@hexwall/shared';

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  snapshot: () => getJSON<ClusterSnapshot>('/api/snapshot'),
  node: (name: string) => getJSON<NodeView>(`/api/node/${encodeURIComponent(name)}`),
  pod: (ns: string, name: string) =>
    getJSON<PodDetail>(`/api/pod/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`),
  healthy: () => getJSON<{ nodes: NodeView[] }>('/api/healthy'),
};

/** Subscribe to live cluster snapshots. Returns an unsubscribe function. */
export function subscribeSnapshots(cb: (s: ClusterSnapshot) => void): () => void {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => {
    try {
      cb(JSON.parse((e as MessageEvent).data) as ClusterSnapshot);
    } catch {
      /* ignore malformed frame */
    }
  });
  return () => es.close();
}

/** Subscribe to a pod's live log stream. Returns an unsubscribe function. */
export function subscribePodLogs(
  ns: string,
  name: string,
  cb: (line: string) => void,
): () => void {
  const es = new EventSource(
    `/api/pod/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/logs`,
  );
  es.addEventListener('log', (e) => {
    try {
      cb((JSON.parse((e as MessageEvent).data) as { line: string }).line);
    } catch {
      /* ignore */
    }
  });
  return () => es.close();
}
