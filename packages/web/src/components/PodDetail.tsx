import { useEffect, useState } from 'react';
import { highlight, type LogLine, type PodDetail as PodDetailT } from '@hexwall/shared';
import { api, subscribePodLogs } from '../api';
import { LogLines } from './LogLines';

interface PodDetailProps {
  ns: string;
  name: string;
  onBack: () => void;
}

export function PodDetail({ ns, name, onBack }: PodDetailProps) {
  const [detail, setDetail] = useState<PodDetailT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LogLine[]>([]);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setLive([]);
    api
      .pod(ns, name)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e)));
    const unsub = subscribePodLogs(ns, name, (raw) => {
      if (alive) setLive((prev) => [...prev.slice(-200), highlight(raw)]);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, [ns, name]);

  if (error)
    return (
      <div className="detail">
        <button className="back" data-testid="back" onClick={onBack}>
          ← back
        </button>
        <p className="muted">{error}</p>
      </div>
    );
  if (!detail)
    return (
      <div className="detail loading" data-testid="pod-detail-loading">
        loading {name}…
      </div>
    );

  const { pod, crash, events, logs } = detail;

  return (
    <div className="detail" data-testid="pod-detail" data-pod={pod.name}>
      <button className="back" data-testid="back" onClick={onBack}>
        ← back
      </button>
      <h2>{pod.name}</h2>
      <div className="sub">
        {pod.namespace} · {pod.workload} · on {pod.node} ·{' '}
        <span className="chip" data-sev={pod.state}>
          {pod.state}
        </span>{' '}
        · {pod.restarts} restarts
      </div>

      {/* 1. Crash block FIRST (UI_SPEC §4) */}
      {crash && (
        <div className="crash-block" data-testid="crash-block">
          <div className="crash-title" data-testid="crash-title">
            {pod.workload} · {crash.reason}
            {crash.exitCode !== undefined ? ` · exit ${crash.exitCode}` : ''}
            {crash.exitReason ? ` (${crash.exitReason})` : ''}
          </div>
          {crash.message && <div className="muted" style={{ marginBottom: 10 }}>{crash.message}</div>}
          <h3>Previous container logs (crashed instance)</h3>
          <LogLines lines={crash.previousLogs} testid="prev-logs" scroll />
        </div>
      )}

      {/* 2. Live / current logs — fixed-height window that scrolls internally and follows the tail */}
      <section className="panel">
        <h3>Logs</h3>
        <LogLines lines={[...logs, ...live]} testid="live-logs" scroll autoScroll />
      </section>

      {/* 3. Events */}
      <section className="panel">
        <h3>Events</h3>
        {events.length === 0 ? (
          <p className="muted">no events</p>
        ) : (
          <table className="events-table" data-testid="events">
            <thead>
              <tr>
                <th>Type</th>
                <th>Reason</th>
                <th>Message</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} data-testid="event-row">
                  <td className="evt-type" data-warn={e.type === 'Warning'}>
                    {e.type}
                  </td>
                  <td>{e.reason}</td>
                  <td>{e.message}</td>
                  <td className="muted">{e.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
