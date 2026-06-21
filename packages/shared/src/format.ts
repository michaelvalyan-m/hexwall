// Pure formatting helpers (UI-facing, but I/O-free so they're unit-testable).

/**
 * Humanize a duration in ms into a compact age string for the wall:
 * 45s · 3m · 42m · 7h · 1h 10m · 2d · 3d 4h. Never throws; clamps negatives to 0.
 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
}
