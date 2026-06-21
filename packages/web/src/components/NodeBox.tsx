import type { QuartileBox } from '@hexwall/shared';
import { HexTile } from './Hex';

interface NodeBoxProps {
  box: QuartileBox;
  chip: string;
  age: string; // humanized time in current state, e.g. '7h'
  ageMs: number;
  onOpen: (id: string) => void;
}

// Border color = node health; the 4 hexagons = pod-state rollup (UI_SPEC §2).
export function NodeBox({ box, chip, age, ageMs, onOpen }: NodeBoxProps) {
  const caption =
    box.litHexes === 0
      ? box.nodeHealth === 'ok'
        ? 'pods healthy'
        : `pods healthy · ${chip}`
      : `${box.affectedPct}% of pods affected · tap to expand`;

  return (
    <div
      className="node-box"
      data-testid="node-box"
      data-node={box.id}
      data-health={box.nodeHealth}
      data-lit={box.litHexes}
      data-lit-sev={box.litSeverity}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(box.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen(box.id);
      }}
    >
      <div className="box-head">
        <span className="box-name">{box.label}</span>
        <span className="box-head-right">
          <span
            className="box-age"
            data-testid="node-age"
            data-age-ms={ageMs}
            title={`in this state for ${age}`}
          >
            <span className="age-glyph" aria-hidden="true">
              ◷
            </span>
            {age}
          </span>
          <span className="chip" data-sev={box.nodeHealth}>
            {chip}
          </span>
        </span>
      </div>
      <div className="hex-row" data-testid="quartile-row">
        {box.hexes.map((sev, i) => (
          <HexTile key={i} sev={sev} testid="quartile-hex" />
        ))}
      </div>
      <div className="box-caption">{caption}</div>
    </div>
  );
}
