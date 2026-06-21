import { describe, expect, it } from 'vitest';
import { computeBox, computeQuartiles, sortBoxes } from './rollup';
import { node, pods } from './_testutil';
import type { QuartileBox, Severity } from './types';

interface Row {
  label: string;
  ok: number;
  warn: number;
  crit: number;
  gone: number;
  podTotal: number;
  affected: number;
  affectedPct: number;
  litHexes: number;
  litSeverity: Severity;
  hexes: Severity[];
}

// FUNCTIONAL_SPEC §4.1 worked-examples table.
const TABLE: Row[] = [
  { label: '17 (14/0/3)', ok: 14, warn: 0, crit: 3, gone: 0, podTotal: 17, affected: 3, affectedPct: 18, litHexes: 1, litSeverity: 'crit', hexes: ['crit', 'ok', 'ok', 'ok'] },
  { label: '16 (15/0/1)', ok: 15, warn: 0, crit: 1, gone: 0, podTotal: 16, affected: 1, affectedPct: 6, litHexes: 1, litSeverity: 'crit', hexes: ['crit', 'ok', 'ok', 'ok'] },
  { label: '20 (8/0/12)', ok: 8, warn: 0, crit: 12, gone: 0, podTotal: 20, affected: 12, affectedPct: 60, litHexes: 3, litSeverity: 'crit', hexes: ['crit', 'crit', 'crit', 'ok'] },
  { label: '13 (11/2/0)', ok: 11, warn: 2, crit: 0, gone: 0, podTotal: 13, affected: 2, affectedPct: 15, litHexes: 1, litSeverity: 'warn', hexes: ['warn', 'ok', 'ok', 'ok'] },
  { label: '18 (18/0/0)', ok: 18, warn: 0, crit: 0, gone: 0, podTotal: 18, affected: 0, affectedPct: 0, litHexes: 0, litSeverity: 'ok', hexes: ['ok', 'ok', 'ok', 'ok'] },
  { label: '4 (0/0/4)', ok: 0, warn: 0, crit: 4, gone: 0, podTotal: 4, affected: 4, affectedPct: 100, litHexes: 4, litSeverity: 'crit', hexes: ['crit', 'crit', 'crit', 'crit'] },
  { label: '10 (9/0/1)+5 gone', ok: 9, warn: 0, crit: 1, gone: 5, podTotal: 10, affected: 1, affectedPct: 10, litHexes: 1, litSeverity: 'crit', hexes: ['crit', 'ok', 'ok', 'ok'] },
  { label: '0 pods', ok: 0, warn: 0, crit: 0, gone: 0, podTotal: 0, affected: 0, affectedPct: 0, litHexes: 0, litSeverity: 'ok', hexes: ['ok', 'ok', 'ok', 'ok'] },
];

describe('computeQuartiles — FUNCTIONAL_SPEC §4.1 worked table', () => {
  it.each(TABLE)('$label', (row) => {
    const q = computeQuartiles(pods(row.ok, row.warn, row.crit, row.gone));
    expect(q.podTotal).toBe(row.podTotal);
    expect(q.affected).toBe(row.affected);
    expect(q.affectedPct).toBe(row.affectedPct);
    expect(q.litHexes).toBe(row.litHexes);
    expect(q.litSeverity).toBe(row.litSeverity);
    expect(q.hexes).toEqual(row.hexes);
  });
});

describe('round-up property — problems never hide', () => {
  it('for any active>0 with affected>=1, litHexes>=1', () => {
    for (let active = 1; active <= 200; active++) {
      for (const affected of [1, 2, Math.ceil(active / 2), active]) {
        if (affected > active) continue;
        const crit = affected;
        const ok = active - affected;
        const q = computeQuartiles(pods(ok, 0, crit, 0));
        expect(q.litHexes).toBeGreaterThanOrEqual(1);
        expect(q.litHexes).toBeLessThanOrEqual(4);
      }
    }
  });

  it('a single bad pod out of 100 still lights exactly one hex', () => {
    const q = computeQuartiles(pods(99, 0, 1, 0));
    expect(q.litHexes).toBe(1);
  });
});

describe('litSeverity — worst severity among affected (crit overrides warn)', () => {
  it('mixed warn+crit pods → litSeverity crit, hexes crit-colored', () => {
    const q = computeQuartiles(pods(8, 2, 3)); // 13 active, 5 affected
    expect(q.litSeverity).toBe('crit');
    expect(q.hexes.filter((h) => h === 'crit').length).toBe(q.litHexes);
  });
  it('warn-only affected → litSeverity warn', () => {
    expect(computeQuartiles(pods(8, 5, 0)).litSeverity).toBe('warn');
  });
});

describe('computeBox — border/pod independence (fold edge case)', () => {
  it('all-crit pods but nodeHealth ok → ok border, lit hexes, not foldEligible', () => {
    const box = computeBox(node('n1', 'ok', pods(0, 0, 4)));
    expect(box.nodeHealth).toBe('ok');
    expect(box.litHexes).toBe(4);
    expect(box.foldEligible).toBe(false);
  });

  it('all-ok pods but nodeHealth crit (DiskPressure) → crit border, 0 lit, NOT foldEligible', () => {
    const box = computeBox(node('n2', 'crit', pods(18, 0, 0)));
    expect(box.nodeHealth).toBe('crit');
    expect(box.litHexes).toBe(0);
    expect(box.litSeverity).toBe('ok');
    expect(box.foldEligible).toBe(false);
  });

  it('all-ok pods and nodeHealth ok → foldEligible', () => {
    const box = computeBox(node('n3', 'ok', pods(12, 0, 0)));
    expect(box.foldEligible).toBe(true);
  });
});

describe('sortBoxes — FUNCTIONAL_SPEC §6 (see DECISIONS D1)', () => {
  function box(id: string, partial: Partial<QuartileBox>): QuartileBox {
    return {
      kind: 'node',
      id,
      label: id,
      nodeHealth: 'ok',
      podTotal: 10,
      affected: 0,
      affectedPct: 0,
      litHexes: 0,
      litSeverity: 'ok',
      hexes: ['ok', 'ok', 'ok', 'ok'],
      chip: 'healthy',
      foldEligible: false,
      changedAt: 0,
      rollup: { severity: 'ok', total: 10, affected: 0, affectedFraction: 0, intensity: 0, bySeverity: { ok: 10, warn: 0, crit: 0, gone: 0 } },
      ...partial,
    };
  }

  it('orders the 5 fixture boxes per §6 (shuffled input)', () => {
    const fixture = [
      box('ip-10-0-9-12', { nodeHealth: 'crit', litHexes: 0, litSeverity: 'ok' }),
      box('ip-10-0-7-30', { nodeHealth: 'ok', litHexes: 3, litSeverity: 'crit' }),
      box('ip-10-0-4-91', { nodeHealth: 'warn', litHexes: 1, litSeverity: 'crit' }),
      box('ip-10-0-2-45', { nodeHealth: 'ok', litHexes: 1, litSeverity: 'crit' }),
      box('ip-10-0-3-08', { nodeHealth: 'ok', litHexes: 1, litSeverity: 'warn' }),
    ];
    const shuffled = [fixture[3], fixture[0], fixture[4], fixture[2], fixture[1]];
    const order = sortBoxes(shuffled).map((b) => b.id);
    expect(order).toEqual([
      'ip-10-0-9-12',
      'ip-10-0-4-91',
      'ip-10-0-7-30',
      'ip-10-0-2-45',
      'ip-10-0-3-08',
    ]);
  });

  it('changedAt desc then id asc are used as later tiebreakers', () => {
    const a = box('b-id', { nodeHealth: 'warn', litSeverity: 'warn', litHexes: 1, changedAt: 100 });
    const b = box('a-id', { nodeHealth: 'warn', litSeverity: 'warn', litHexes: 1, changedAt: 200 });
    const c = box('c-id', { nodeHealth: 'warn', litSeverity: 'warn', litHexes: 1, changedAt: 200 });
    const order = sortBoxes([a, b, c]).map((x) => x.id);
    // changedAt 200 first (b,c), tiebreak id asc → a-id (b) before c-id (c); then a (changedAt 100)
    expect(order).toEqual(['a-id', 'c-id', 'b-id']);
  });
});
