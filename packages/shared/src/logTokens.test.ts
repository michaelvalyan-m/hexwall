import { describe, expect, it } from 'vitest';
import { highlight, highlightAll, spanKinds } from './logTokens';
import type { LogLine } from './types';

function kindsOf(l: LogLine): string[] {
  return l.spans.map((s) => s.kind);
}
function hasSpan(l: LogLine, text: string, kind: 'plain' | 'warn' | 'crit'): boolean {
  return l.spans.some((s) => s.text === text && s.kind === kind);
}
function kindOfText(l: LogLine, text: string): string | undefined {
  return l.spans.find((s) => s.text.includes(text))?.kind;
}

describe('highlight — crit tokens', () => {
  it('OOMKilled is one crit span, not oom+plain', () => {
    const l = highlight('OOMKilled');
    expect(l.spans).toEqual([{ text: 'OOMKilled', kind: 'crit' }]);
  });

  it.each([['500'], ['502'], ['503'], ['504'], ['599'], ['418 nope 533']])(
    '5xx %s highlights crit',
    (line) => {
      const l = highlight(line);
      expect(l.spans.some((s) => s.kind === 'crit')).toBe(true);
    },
  );

  it.each([['panic'], ['fatal'], ['segfault'], ['stacktrace'], ['traceback'], ['oom']])(
    'crit word %s',
    (w) => {
      expect(highlight(w).spans.some((s) => s.kind === 'crit')).toBe(true);
    },
  );

  it('exit code 137 / 139 and signal: killed are crit', () => {
    expect(hasSpan(highlight('exit code 137'), 'exit code 137', 'crit')).toBe(true);
    expect(hasSpan(highlight('exit code 139'), 'exit code 139', 'crit')).toBe(true);
    expect(highlight('signal: killed').spans.some((s) => s.kind === 'crit')).toBe(true);
  });

  it.each([['401'], ['403'], ['429']])('4xx auth/abuse %s is promoted to crit', (w) => {
    const l = highlight(`status ${w} seen`);
    expect(hasSpan(l, w, 'crit')).toBe(true);
    expect(hasSpan(l, w, 'warn')).toBe(false);
  });
});

describe('highlight — warn tokens', () => {
  it.each([
    ['error'],
    ['ERROR'],
    ['err'],
    ['failed'],
    ['failure'],
    ['warn'],
    ['warning'],
    ['timeout'],
    ['timed out'],
    ['refused'],
    ['unavailable'],
    ['retry'],
    ['retrying'],
    ['exception'],
  ])('warn word %s', (w) => {
    expect(highlight(w).spans.some((s) => s.kind === 'warn')).toBe(true);
  });

  it.each([['400'], ['404'], ['418'], ['499']])('generic 4xx %s is warn', (w) => {
    expect(kindOfText(highlight(`http ${w}`), w)).toBe('warn');
  });
});

describe('highlight — structure', () => {
  it('a plain line yields a single plain span', () => {
    const l = highlight('starting payments-api v1.8.2');
    expect(l.spans).toEqual([{ text: 'starting payments-api v1.8.2', kind: 'plain' }]);
  });

  it('empty string does not throw and yields no spans', () => {
    expect(() => highlight('')).not.toThrow();
    expect(highlight('').spans).toEqual([]);
  });

  it('mixed line carries both warn and crit spans, plain text preserved', () => {
    const l = highlight('2026 ERROR upstream returned 503 from inventory-svc');
    expect(hasSpan(l, 'ERROR', 'warn')).toBe(true);
    expect(hasSpan(l, '503', 'crit')).toBe(true);
    // raw reconstructs from spans
    expect(l.spans.map((s) => s.text).join('')).toBe(l.raw);
  });

  it('case-insensitive matching', () => {
    expect(highlight('PANIC').spans.some((s) => s.kind === 'crit')).toBe(true);
    expect(highlight('Timeout').spans.some((s) => s.kind === 'warn')).toBe(true);
  });

  it('highlightAll maps a list and spanKinds reports the kinds present', () => {
    const lines = highlightAll(['plain line', 'boom 500 error']);
    expect(lines).toHaveLength(2);
    expect(spanKinds(lines[0])).toEqual(new Set(['plain']));
    expect(spanKinds(lines[1])).toEqual(new Set(['plain', 'warn', 'crit']));
  });

  it('does not flag 3-digit groups inside timestamps', () => {
    const l = highlight('2026-06-20T11:02:13Z INFO connected to postgres');
    expect(kindsOf(l)).toEqual(['plain']);
  });

  it('the canonical crash log lines highlight as the spec requires', () => {
    expect(highlight('2026 ERROR upstream returned 503 from inventory-svc').spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: '503', kind: 'crit' }),
        expect.objectContaining({ kind: 'warn' }),
      ]),
    );
    expect(
      highlight('2026 WARN retrying request (attempt 2) ... timeout').spans.some(
        (s) => s.kind === 'warn',
      ),
    ).toBe(true);
    expect(highlight('2026 panic: runtime: out of memory').spans.some((s) => s.kind === 'crit')).toBe(
      true,
    );
    const sig = highlight('2026 signal: killed (exit code 137 / OOMKilled)');
    expect(sig.spans.filter((s) => s.kind === 'crit').length).toBeGreaterThanOrEqual(1);
    expect(sig.spans.some((s) => s.text.includes('OOMKilled') && s.kind === 'crit')).toBe(true);
  });
});
