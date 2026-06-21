// Log tokenizer / highlighter (FUNCTIONAL_SPEC §7). Pure, deterministic, never throws.
// Splits a line into spans of kind plain | warn | crit. Case-insensitive. Longest/most-specific
// match wins for overlaps (OOMKilled stays one crit span, not oom+plain); crit beats warn where
// they overlap (so 401/403/429 — also matched by the generic 4xx warn rule — end up crit).

import type { LogLine, LogSpan } from './types';

type Kind = LogSpan['kind'];

// Each pattern is global + case-insensitive so we can scan all occurrences.
function re(source: string): RegExp {
  return new RegExp(source, 'gi');
}

// warn-level tokens (amber)
const WARN_PATTERNS: RegExp[] = [
  re('\\btimed out\\b'),
  re('\\bwarning\\b'),
  re('\\bwarn\\b'),
  re('\\berror\\b'),
  re('\\berr\\b'),
  re('\\bfailure\\b'),
  re('\\bfailed\\b'),
  re('\\btimeout\\b'),
  re('\\brefused\\b'),
  re('\\bunavailable\\b'),
  re('\\bretrying\\b'),
  re('\\bretry\\b'),
  re('\\bexception\\b'),
  re('\\b4\\d{2}\\b'), // HTTP 4xx (401/403/429 get promoted to crit below)
];

// crit-level tokens (red) — applied after warn so they override on overlap.
const CRIT_PATTERNS: RegExp[] = [
  re('\\bexit code 137\\b'),
  re('\\bexit code 139\\b'),
  re('signal: killed'),
  re('\\boomkilled\\b'),
  re('\\bsegfault\\b'),
  re('\\bstacktrace\\b'),
  re('\\btraceback\\b'),
  re('\\bpanic\\b'),
  re('\\bfatal\\b'),
  re('\\boom\\b'),
  re('\\b5\\d{2}\\b'), // HTTP 5xx (incl. 500/502/503/504)
  re('\\b401\\b'),
  re('\\b403\\b'),
  re('\\b429\\b'),
];

function applyPatterns(line: string, kinds: Kind[], patterns: RegExp[], kind: Kind): void {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    // Every pattern matches at least one character (word-boundary words, multi-char phrases,
    // 3-digit status codes), so exec always advances — no zero-width-loop guard is needed.
    while ((m = pattern.exec(line)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      for (let i = start; i < end; i++) kinds[i] = kind;
    }
  }
}

export function highlight(line: string): LogLine {
  const raw = line ?? '';
  if (raw.length === 0) return { raw: '', spans: [] };

  const kinds: Kind[] = new Array(raw.length).fill('plain');
  // warn first, then crit overrides where they coincide.
  applyPatterns(raw, kinds, WARN_PATTERNS, 'warn');
  applyPatterns(raw, kinds, CRIT_PATTERNS, 'crit');

  // Coalesce consecutive same-kind characters into spans.
  const spans: LogSpan[] = [];
  let runStart = 0;
  for (let i = 1; i <= raw.length; i++) {
    if (i === raw.length || kinds[i] !== kinds[runStart]) {
      spans.push({ text: raw.slice(runStart, i), kind: kinds[runStart] });
      runStart = i;
    }
  }
  return { raw, spans };
}

export function highlightAll(lines: string[]): LogLine[] {
  return lines.map((l) => highlight(l));
}

// Convenience for tests/UI: which kinds appear in a line.
export function spanKinds(line: LogLine): Set<Kind> {
  return new Set(line.spans.map((s) => s.kind));
}
