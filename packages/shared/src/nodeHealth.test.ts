import { describe, expect, it } from 'vitest';
import { deriveNodeHealth, nodeChip, type NodeHealthInput } from './nodeHealth';
import type { Severity } from './types';

function n(partial: Partial<NodeHealthInput>): NodeHealthInput {
  return {
    ready: true,
    conditions: {},
    cpu: { usagePct: 10 },
    mem: { usagePct: 10 },
    disk: { usagePct: 10 },
    net: { ready: true },
    ...partial,
  };
}

describe('deriveNodeHealth — memory boundaries', () => {
  it.each<[number, Severity]>([
    [84, 'ok'],
    [85, 'warn'],
    [94, 'warn'],
    [95, 'crit'],
  ])('mem %i%% → %s', (usagePct, expected) => {
    expect(deriveNodeHealth(n({ mem: { usagePct } }))).toBe(expected);
  });
});

describe('deriveNodeHealth — disk boundaries', () => {
  it.each<[number, Severity]>([
    [79, 'ok'],
    [80, 'warn'],
    [89, 'warn'],
    [90, 'crit'],
  ])('disk %i%% → %s', (usagePct, expected) => {
    expect(deriveNodeHealth(n({ disk: { usagePct } }))).toBe(expected);
  });
});

describe('deriveNodeHealth — cpu / requests / net', () => {
  it('cpu 89 → ok, 90 → warn', () => {
    expect(deriveNodeHealth(n({ cpu: { usagePct: 89 } }))).toBe('ok');
    expect(deriveNodeHealth(n({ cpu: { usagePct: 90 } }))).toBe('warn');
  });
  it('cpu requestPct >= 100 → warn (requests-vs-usage trap)', () => {
    expect(deriveNodeHealth(n({ cpu: { usagePct: 5, requestPct: 100 } }))).toBe('warn');
  });
  it('net loss 4 → ok, 5 → warn', () => {
    expect(deriveNodeHealth(n({ net: { ready: true, lossPct: 4 } }))).toBe('ok');
    expect(deriveNodeHealth(n({ net: { ready: true, lossPct: 5 } }))).toBe('warn');
  });
});

describe('deriveNodeHealth — condition signals → crit', () => {
  it('NotReady → crit', () => {
    expect(deriveNodeHealth(n({ ready: false }))).toBe('crit');
  });
  it.each(['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'])(
    'pressure %s → crit',
    (cond) => {
      expect(deriveNodeHealth(n({ conditions: { [cond]: true } }))).toBe('crit');
    },
  );
  it('net.ready false → crit', () => {
    expect(deriveNodeHealth(n({ net: { ready: false } }))).toBe('crit');
  });
});

describe('deriveNodeHealth — worst wins', () => {
  it('mem warn + DiskPressure crit → crit', () => {
    expect(
      deriveNodeHealth(n({ mem: { usagePct: 88 }, conditions: { DiskPressure: true } })),
    ).toBe('crit');
  });
  it('multiple warns → warn', () => {
    expect(
      deriveNodeHealth(n({ mem: { usagePct: 88 }, cpu: { usagePct: 92 } })),
    ).toBe('warn');
  });
  it('all clear → ok', () => {
    expect(deriveNodeHealth(n({}))).toBe('ok');
  });

  // The MOCK_SCENARIOS §1 node-health inputs:
  it('ip-10-0-4-91 inputs (mem 88, no pressure) → warn', () => {
    expect(deriveNodeHealth(n({ mem: { usagePct: 88 } }))).toBe('warn');
  });
  it('ip-10-0-9-12 inputs (disk 96 + DiskPressure) → crit', () => {
    expect(
      deriveNodeHealth(n({ disk: { usagePct: 96 }, conditions: { DiskPressure: true } })),
    ).toBe('crit');
  });
});

describe('nodeChip — UI_SPEC §2', () => {
  function full(partial: Partial<NodeHealthInput>) {
    const input = n(partial);
    return { ...input, health: deriveNodeHealth(input) };
  }
  it('healthy node → "healthy"', () => {
    expect(nodeChip(full({}))).toBe('healthy');
  });
  it('mem 88 → "mem 88%"', () => {
    expect(nodeChip(full({ mem: { usagePct: 88 } }))).toBe('mem 88%');
  });
  it('disk 96 + DiskPressure → "disk 96%"', () => {
    expect(nodeChip(full({ disk: { usagePct: 96 }, conditions: { DiskPressure: true } }))).toBe(
      'disk 96%',
    );
  });
  it('NotReady node → "NotReady"', () => {
    expect(nodeChip(full({ ready: false }))).toBe('NotReady');
  });
});
