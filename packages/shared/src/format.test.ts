import { describe, expect, it } from 'vitest';
import { formatAge } from './format';

const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

describe('formatAge', () => {
  it.each<[number, string]>([
    [0, '0s'],
    [45 * S, '45s'],
    [59 * S, '59s'],
    [60 * S, '1m'],
    [3 * M, '3m'],
    [42 * M, '42m'],
    [59 * M, '59m'],
    [60 * M, '1h'],
    [70 * M, '1h 10m'],
    [7 * H, '7h'],
    [23 * H, '23h'],
    [24 * H, '1d'],
    [2 * D, '2d'],
    [50 * H, '2d 2h'],
  ])('%i ms → %s', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });

  it('clamps negatives and non-finite to 0s and never throws', () => {
    expect(formatAge(-5000)).toBe('0s');
    expect(formatAge(NaN)).toBe('0s');
    expect(formatAge(Infinity)).toBe('0s');
  });
});
