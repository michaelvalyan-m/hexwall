import { useEffect, useState } from 'react';
import type { ClusterSnapshot } from '@tessera/shared';
import { api, subscribeSnapshots } from './api';
import { Wall } from './components/Wall';
import { NodeDetail } from './components/NodeDetail';
import { PodDetail } from './components/PodDetail';
import { ThemeSwitcher, type ThemeMode } from './components/ThemeSwitcher';

type View =
  | { level: 'wall' }
  | { level: 'node'; name: string }
  | { level: 'pod'; ns: string; name: string };

interface Snap {
  snapshot: ClusterSnapshot;
  receivedAt: number; // client wall-clock ms when this snapshot arrived (for live age ticking)
}

// Extract cell id from '/cell/<id>' paths (PLATFORM_MODEL §6).
function cellIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/cell\/(.+)$/);
  return m ? m[1] : null;
}

export function App() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [view, setView] = useState<View>({ level: 'wall' });
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const cellId = snap?.snapshot.cellId;

  // Theme effect
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = themeMode === 'system' ? (mq.matches ? 'dark' : 'light') : themeMode;
      document.documentElement.setAttribute('data-theme', effective);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [themeMode]);

  // Reflect the resolved cluster cell in the URL as /cell/<cellId> (PLATFORM_MODEL §6). Keyed on
  // the stable cellId so it runs once, not on every SSE frame. The node/pod zoom stays in React
  // state — those are sub-zooms within the EKS leaf renderer, not separate cell URLs (§9 item 5),
  // so no pushState/popstate history is maintained for them.
  useEffect(() => {
    if (!cellId) return;
    if (cellIdFromPath() !== cellId) {
      history.replaceState(null, '', `/cell/${cellId}`);
    }
  }, [cellId]);

  useEffect(() => {
    let alive = true;
    const receive = (s: ClusterSnapshot) => alive && setSnap({ snapshot: s, receivedAt: Date.now() });
    api.snapshot().then(receive).catch(() => {});
    const unsub = subscribeSnapshots(receive);
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  let body: JSX.Element;
  if (view.level === 'node') {
    body = (
      <NodeDetail
        name={view.name}
        onBack={() => setView({ level: 'wall' })}
        onOpenPod={(ns, name) => setView({ level: 'pod', ns, name })}
      />
    );
  } else if (view.level === 'pod') {
    body = <PodDetail ns={view.ns} name={view.name} onBack={() => setView({ level: 'wall' })} />;
  } else if (!snap) {
    body = (
      <div className="loading" data-testid="app-loading">
        connecting to cluster…
      </div>
    );
  } else {
    body = (
      <Wall
        snapshot={snap.snapshot}
        receivedAt={snap.receivedAt}
        onOpenNode={(name) => setView({ level: 'node', name })}
      />
    );
  }

  return (
    <>
      {body}
      <ThemeSwitcher mode={themeMode} onChange={setThemeMode} />
    </>
  );
}
