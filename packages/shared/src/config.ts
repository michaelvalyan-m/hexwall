// Single source of truth for all tunable thresholds (FUNCTIONAL_SPEC §10).
// Tests import CONFIG rather than hardcoding numbers.

export const CONFIG = {
  PENDING_WARN_SECONDS: 120,
  RESTART_WARN_COUNT: 3,
  MEM_WARN: 85,
  MEM_CRIT: 95,
  DISK_WARN: 80,
  DISK_CRIT: 90,
  CPU_WARN: 90,
  NET_WARN: 5,
  FOLD_HYSTERESIS_SECONDS: 45,
  // Pulsation intensity weights (PLATFORM_MODEL §5). Single source of truth — consumed by
  // the one `intensityFrom()` helper used at every level of the recursive rollup.
  INTENSITY_W_FRACTION: 0.5,
  INTENSITY_W_MAGNITUDE: 0.5,
  INTENSITY_LOG_MAX: 4, // log10(10000): 10k affected leaf units → full intensity
} as const;

export type Config = typeof CONFIG;

// Color vocabulary (FUNCTIONAL_SPEC §1). Exposed for the web app + tests.
import type { Severity } from './types';

export const SEVERITY_COLORS: Record<Severity, string> = {
  ok: '#639922',
  warn: '#EF9F27',
  crit: '#E24B4A',
  gone: '#888780',
};

// Severity ordering for "take the worst": crit > warn > ok > gone.
export const SEVERITY_RANK: Record<Severity, number> = {
  crit: 3,
  warn: 2,
  ok: 1,
  gone: 0,
};

export function worst(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function worstOf(severities: Severity[]): Severity {
  return severities.reduce<Severity>((acc, s) => worst(acc, s), 'gone');
}
