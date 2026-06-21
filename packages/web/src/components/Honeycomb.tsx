import type { PodView } from '@tessera/shared';
import { Hex, hexLayout } from './Hex';

interface HoneycombProps {
  pods: PodView[];
  onOpenPod: (ns: string, name: string) => void;
}

// Real per-pod honeycomb (UI_SPEC §3): every pod is a hexagon, true cardinality, packed in
// offset rows. The "expanded" form of the 4 rollup hexagons.
export function Honeycomb({ pods, onOpenPod }: HoneycombProps) {
  const r = 17;
  const { hstep, vstep } = hexLayout(r);
  const cols = Math.max(1, Math.ceil(Math.sqrt(pods.length * 1.4)));
  const margin = r + 2;

  const placed = pods.map((p, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const cx = margin + col * hstep + (row % 2) * (hstep / 2);
    const cy = margin + row * vstep;
    return { p, cx, cy };
  });

  const rows = Math.ceil(pods.length / cols);
  const width = cols * hstep + hstep + margin;
  const height = rows * vstep + r + margin;

  return (
    <svg
      className="honeycomb"
      data-testid="honeycomb"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {placed.map(({ p, cx, cy }) => (
        <Hex
          key={`${p.namespace}/${p.name}`}
          cx={cx}
          cy={cy}
          r={r}
          sev={p.state}
          podNs={p.namespace}
          podName={p.name}
          testid="pod-hex"
          title={`${p.name}${p.reason ? ` · ${p.reason}` : ''} (${p.state})`}
          onClick={() => onOpenPod(p.namespace, p.name)}
        />
      ))}
    </svg>
  );
}
