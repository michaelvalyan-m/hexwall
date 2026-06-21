import { useEffect, useState } from 'react';
import { CONFIG, type NodeResource, type NodeView, type Severity } from '@hexwall/shared';
import { api } from '../api';
import { Honeycomb } from './Honeycomb';

function resSeverity(kind: 'cpu' | 'mem' | 'disk', usagePct: number): Severity {
  if (kind === 'mem') return usagePct >= CONFIG.MEM_CRIT ? 'crit' : usagePct >= CONFIG.MEM_WARN ? 'warn' : 'ok';
  if (kind === 'disk') return usagePct >= CONFIG.DISK_CRIT ? 'crit' : usagePct >= CONFIG.DISK_WARN ? 'warn' : 'ok';
  return usagePct >= CONFIG.CPU_WARN ? 'warn' : 'ok';
}

function ResBar({ label, kind, res }: { label: string; kind: 'cpu' | 'mem' | 'disk'; res: NodeResource }) {
  const sev = resSeverity(kind, res.usagePct);
  const reqSev = (res.requestPct ?? 0) >= 100 ? 'warn' : sev;
  return (
    <div className="res-row" data-testid={`res-${kind}`} data-sev={sev}>
      <div className="res-label">
        <span>{label}</span>
        <span className="muted">
          {Math.round(res.usagePct)}%{res.requestPct !== undefined ? ` · req ${Math.round(res.requestPct)}%` : ''}
        </span>
      </div>
      <div className="res-track">
        <div className="res-fill" data-sev={reqSev} style={{ width: `${Math.min(100, res.usagePct)}%` }} />
        {res.requestPct !== undefined && res.requestPct !== res.usagePct && (
          <div className="res-req" style={{ left: `${Math.min(100, res.requestPct)}%` }} />
        )}
      </div>
    </div>
  );
}

interface NodeDetailProps {
  name: string;
  onBack: () => void;
  onOpenPod: (ns: string, name: string) => void;
}

export function NodeDetail({ name, onBack, onOpenPod }: NodeDetailProps) {
  const [node, setNode] = useState<NodeView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .node(name)
      .then((n) => alive && setNode(n))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [name]);

  if (error) return <div className="detail"><Back onBack={onBack} /><p className="muted">{error}</p></div>;
  if (!node) return <div className="detail loading" data-testid="node-detail-loading">loading {name}…</div>;

  const crit = node.pods.filter((p) => p.state === 'crit').length;
  const warn = node.pods.filter((p) => p.state === 'warn').length;
  const netSev: Severity = !node.net.ready || (node.net.lossPct ?? 0) >= CONFIG.NET_WARN ? (!node.net.ready ? 'crit' : 'warn') : 'ok';

  return (
    <div className="detail" data-testid="node-detail" data-node={node.name} data-health={node.health}>
      <Back onBack={onBack} />
      <h2>{node.name}</h2>
      <div className="sub">
        {node.instanceType ?? 'node'} · {node.pods.length} pods ·{' '}
        <span className="chip" data-sev={node.health}>
          {node.health}
        </span>{' '}
        {crit > 0 && <span style={{ color: 'var(--crit)' }}>{crit} crit</span>}{' '}
        {warn > 0 && <span style={{ color: 'var(--warn)' }}>{warn} warn</span>}
      </div>

      <div className="two-col">
        <section className="panel">
          <h3>Pods ({node.pods.length})</h3>
          <Honeycomb pods={node.pods} onOpenPod={onOpenPod} />
        </section>

        <section className="panel">
          <h3>Resources</h3>
          <ResBar label="CPU" kind="cpu" res={node.cpu} />
          <ResBar label="Memory" kind="mem" res={node.mem} />
          <ResBar label="Disk" kind="disk" res={node.disk} />
          <div className="res-row" data-testid="res-net" data-sev={netSev}>
            <div className="res-label">
              <span>Network</span>
              <span className="muted">
                {node.net.ready ? 'ready' : 'unavailable'}
                {node.net.lossPct !== undefined ? ` · ${node.net.lossPct}% loss` : ''}
              </span>
            </div>
            <div className="res-track">
              <div className="res-fill" data-sev={netSev} style={{ width: node.net.ready ? '100%' : '20%' }} />
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>Conditions</h3>
          <div className="cond-chips">
            <span className="chip" data-sev={node.ready ? 'ok' : 'crit'}>
              {node.ready ? 'Ready' : 'NotReady'}
            </span>
            {Object.entries(node.conditions).map(([k, v]) => (
              <span className="chip" data-sev={v ? 'crit' : 'ok'} key={k}>
                {k}: {v ? 'true' : 'false'}
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Back({ onBack }: { onBack: () => void }) {
  return (
    <button className="back" data-testid="back" onClick={onBack}>
      ← back to wall
    </button>
  );
}
