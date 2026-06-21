import { useEffect, useState } from 'react';
import { formatAge, type ClusterSnapshot, type NodeView } from '@hexwall/shared';
import { api } from '../api';
import { NodeBox } from './NodeBox';

interface WallProps {
  snapshot: ClusterSnapshot;
  receivedAt: number; // client ms when this snapshot arrived (anchors live age ticking)
  onOpenNode: (id: string) => void;
}

export function Wall({ snapshot, receivedAt, onOpenNode }: WallProps) {
  const [revealed, setRevealed] = useState(false);
  const [healthy, setHealthy] = useState<NodeView[] | null>(null);
  const [, setTick] = useState(0);

  // Re-render once a second so the age badges tick up between snapshots.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function togglePill() {
    if (!revealed && !healthy) {
      try {
        setHealthy((await api.healthy()).nodes);
      } catch {
        setHealthy([]);
      }
    }
    setRevealed((r) => !r);
  }

  const need = snapshot.boxes.length;

  // Age of a box's current state: server-anchored (generatedAt − changedAt), advanced by the
  // real time elapsed on the client since the snapshot arrived. Works in both real- and
  // manual-clock (test) modes because it is anchored to the snapshot's own clock.
  function ageMsFor(changedAt: number): number {
    return Math.max(0, snapshot.generatedAt - changedAt + (Date.now() - receivedAt));
  }

  return (
    <div className="app" data-testid="wall">
      <header className="app-header">
        <h1>Hexwall</h1>
        <span className="summary" data-testid="summary">
          {snapshot.cluster} · {snapshot.totals.nodes} nodes · {need} need attention
        </span>
        <span className="spacer" />
        <button className="folded-pill" data-testid="folded-pill" onClick={togglePill}>
          <span className="dot" />
          {snapshot.healthyFolded} healthy nodes folded
        </button>
      </header>

      {revealed && (
        <div className="healthy-strip" data-testid="healthy-strip">
          {(healthy ?? []).map((n) => (
            <button
              className="healthy-tile"
              key={n.name}
              data-testid="healthy-tile"
              data-node={n.name}
              title={`open ${n.name}`}
              onClick={() => onOpenNode(n.name)}
            >
              {n.name}
            </button>
          ))}
          {(healthy ?? []).length === 0 && <span className="muted">no folded nodes</span>}
        </div>
      )}

      <main className="wall" data-testid="wall-grid">
        {snapshot.boxes.map((box) => {
          const ms = ageMsFor(box.changedAt);
          return (
            <NodeBox
              key={box.id}
              box={box}
              chip={box.chip}
              ageMs={ms}
              age={formatAge(ms)}
              onOpen={onOpenNode}
            />
          );
        })}
      </main>
    </div>
  );
}
