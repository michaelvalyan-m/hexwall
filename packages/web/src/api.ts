// REST + SSE client. Same-origin (server serves the web in prod/e2e; Vite proxies /api in dev).

import type { Cell, ClusterSnapshot, NodeView, PodDetail } from '@tessera/shared';

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
  // Fetch a Tessera Cell by its global path id (PLATFORM_MODEL §6). The id is a slash-delimited
  // path and is NOT percent-encoded — the server route matches on the full path. In this slice
  // only the EKS *resource* cell id resolves (renderKey 'eks-cluster'); node/pod child ids and
  // parent stub levels are not yet routed (node/pod are React-state sub-zooms — §9 item 5).
  cell: (id: string) => getJSON<Cell>(`/api/cell/${id}`),
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
