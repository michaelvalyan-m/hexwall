import type { Severity } from '@hexwall/shared';

/** Pointy-top hexagon vertices (a vertex straight up). */
export function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// Packing geometry for offset rows of pointy-top hexes.
export function hexLayout(r: number) {
  return { hstep: Math.sqrt(3) * r, vstep: 1.5 * r };
}

interface HexProps {
  cx: number;
  cy: number;
  r: number;
  sev: Severity;
  onClick?: () => void;
  title?: string;
  podNs?: string;
  podName?: string;
  testid?: string;
}

export function Hex({ cx, cy, r, sev, onClick, title, podNs, podName, testid }: HexProps) {
  return (
    <polygon
      points={hexPoints(cx, cy, r)}
      className={`hex-${sev} hex-stroke ${onClick ? 'pod-hex' : ''}`}
      data-sev={sev}
      data-testid={testid}
      data-pod-ns={podNs}
      data-pod-name={podName}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {title ? <title>{title}</title> : null}
    </polygon>
  );
}

/** A single hex rendered as its own small inline SVG (used for the wall's 4-hex meter row). */
export function HexTile({ sev, testid }: { sev: Severity; testid?: string }) {
  const r = 13;
  const w = Math.sqrt(3) * r + 2;
  const h = 2 * r + 2;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <Hex cx={w / 2} cy={h / 2} r={r} sev={sev} testid={testid} />
    </svg>
  );
}
