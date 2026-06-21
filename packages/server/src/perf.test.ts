// Scale smoke test (MOCK_SCENARIOS §4): the `big` fixture builds a snapshot fast and the fold
// keeps the rendered box count small.

import { describe, expect, it } from 'vitest';
import { RollupEngine } from '@tessera/shared';
import { buildBigFixture } from './providers/fixtures';

describe('big fixture performance', () => {
  it('snapshot build is < 50ms and folds the healthy bulk', () => {
    const fixture = buildBigFixture(400);
    const engine = new RollupEngine();
    const now = Date.UTC(2026, 5, 20, 11, 5, 0);

    const t0 = performance.now();
    const snap = engine.computeSnapshot(fixture.nodes, now, fixture.cluster);
    const ms = performance.now() - t0;

    expect(ms).toBeLessThan(50);
    expect(fixture.nodes.length).toBe(403);
    expect(snap.healthyFolded).toBe(400); // only the 3 problem nodes remain
    expect(snap.boxes.length).toBe(3);
  });
});
