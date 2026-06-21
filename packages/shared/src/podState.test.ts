import { describe, expect, it } from 'vitest';
import { classifyPod } from './podState';
import { CONFIG } from './config';
import type { PodStatusLike } from './types';

const NOW = 1_000_000_000;

function base(partial: Partial<PodStatusLike>): PodStatusLike {
  return {
    name: 'p',
    namespace: 'ns',
    workload: 'w',
    node: 'n',
    phase: 'Running',
    ...partial,
  };
}

describe('classifyPod — crit', () => {
  it('CrashLoopBackOff → crit', () => {
    const r = classifyPod(
      base({ containerStatuses: [{ state: { waiting: { reason: 'CrashLoopBackOff' } } }] }),
      NOW,
    );
    expect(r.state).toBe('crit');
    expect(r.reason).toBe('CrashLoopBackOff');
  });

  it('OOMKilled in lastState with restarts>0 → crit (with reason/exitCode)', () => {
    const r = classifyPod(
      base({
        containerStatuses: [
          { restartCount: 8, lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } } },
        ],
      }),
      NOW,
    );
    expect(r.state).toBe('crit');
    expect(r.reason).toBe('OOMKilled');
    expect(r.exitCode).toBe(137);
    expect(r.restarts).toBe(8);
  });

  it('OOMKilled in lastState but restarts===0 → not crit by that rule (ok if running ready)', () => {
    const r = classifyPod(
      base({
        containerStatuses: [
          { restartCount: 0, ready: true, lastState: { terminated: { reason: 'OOMKilled' } } },
        ],
      }),
      NOW,
    );
    expect(r.state).toBe('ok');
  });

  it.each(['ImagePullBackOff', 'ErrImagePull', 'CreateContainerError', 'RunContainerError'])(
    'waiting reason %s → crit',
    (reason) => {
      const r = classifyPod(base({ containerStatuses: [{ state: { waiting: { reason } } }] }), NOW);
      expect(r.state).toBe('crit');
    },
  );

  it('state.terminated Error with exitCode != 0 → crit', () => {
    const r = classifyPod(
      base({ containerStatuses: [{ state: { terminated: { reason: 'Error', exitCode: 1 } } }] }),
      NOW,
    );
    expect(r.state).toBe('crit');
    expect(r.exitCode).toBe(1);
  });

  it('phase Failed → crit', () => {
    expect(classifyPod(base({ phase: 'Failed' }), NOW).state).toBe('crit');
  });
});

describe('classifyPod — gone', () => {
  it('Succeeded → gone', () => {
    expect(classifyPod(base({ phase: 'Succeeded' }), NOW).state).toBe('gone');
  });
  it('deletionTimestamp set → gone (Terminating)', () => {
    expect(
      classifyPod(base({ phase: 'Running', deletionTimestamp: '2026-01-01T00:00:00Z' }), NOW).state,
    ).toBe('gone');
  });
});

describe('classifyPod — warn', () => {
  it('Pending under threshold → ok', () => {
    const r = classifyPod(
      base({ phase: 'Pending', pendingSince: NOW - 60 * 1000 }),
      NOW,
    );
    expect(r.state).toBe('ok');
  });

  it('Pending over PENDING_WARN_SECONDS → warn', () => {
    const r = classifyPod(
      base({ phase: 'Pending', pendingSince: NOW - (CONFIG.PENDING_WARN_SECONDS + 5) * 1000 }),
      NOW,
    );
    expect(r.state).toBe('warn');
    expect(r.reason).toBe('PendingTooLong');
  });

  it('restartCount >= RESTART_WARN_COUNT (not crashlooping) → warn', () => {
    const r = classifyPod(
      base({ containerStatuses: [{ restartCount: CONFIG.RESTART_WARN_COUNT, ready: true }] }),
      NOW,
    );
    expect(r.state).toBe('warn');
    expect(r.reason).toBe('RestartsClimbing');
  });

  it('readiness probe failing while Running → warn', () => {
    const r = classifyPod(
      base({ phase: 'Running', containerStatuses: [{ ready: false, restartCount: 0 }] }),
      NOW,
    );
    expect(r.state).toBe('warn');
    expect(r.reason).toBe('ProbeFailing');
  });
});

describe('classifyPod — ok', () => {
  it('Running + Ready → ok', () => {
    const r = classifyPod(
      base({ phase: 'Running', containerStatuses: [{ ready: true, restartCount: 0 }] }),
      NOW,
    );
    expect(r.state).toBe('ok');
  });
});
