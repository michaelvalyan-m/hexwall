// Pod state machine (FUNCTIONAL_SPEC §2). Pure. Evaluate in order; first match wins.

import { CONFIG } from './config';
import type { ContainerStatusLike, PodStatusLike, Severity } from './types';

const CRIT_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerError',
  'CreateContainerConfigError',
  'RunContainerError',
]);

const CRIT_LASTTERM_REASONS = new Set(['OOMKilled', 'Error']);

function containers(pod: PodStatusLike): ContainerStatusLike[] {
  return pod.containerStatuses ?? [];
}

function anyWaitingCrit(pod: PodStatusLike): ContainerStatusLike | undefined {
  return containers(pod).find(
    (c) => c.state?.waiting?.reason && CRIT_WAITING_REASONS.has(c.state.waiting.reason),
  );
}

function maxRestarts(pod: PodStatusLike): number {
  return containers(pod).reduce((m, c) => Math.max(m, c.restartCount ?? 0), 0);
}

export interface PodClassification {
  state: Severity;
  reason?: string;
  message?: string;
  exitCode?: number;
  restarts: number;
}

export function classifyPod(pod: PodStatusLike, now: number): PodClassification {
  const cs = containers(pod);
  const restarts = maxRestarts(pod);

  // ---- 1. crit ----
  const waitingCrit = anyWaitingCrit(pod);
  if (waitingCrit) {
    const term = waitingCrit.lastState?.terminated;
    return {
      state: 'crit',
      reason: waitingCrit.state!.waiting!.reason,
      message: waitingCrit.state!.waiting!.message ?? term?.message,
      exitCode: term?.exitCode,
      restarts,
    };
  }

  // lastState.terminated.reason in {OOMKilled, Error} AND restartCount > 0
  const lastTermCrit = cs.find(
    (c) =>
      c.lastState?.terminated?.reason &&
      CRIT_LASTTERM_REASONS.has(c.lastState.terminated.reason) &&
      (c.restartCount ?? 0) > 0,
  );
  if (lastTermCrit) {
    const term = lastTermCrit.lastState!.terminated!;
    return {
      state: 'crit',
      reason: term.reason,
      message: term.message,
      exitCode: term.exitCode,
      restarts,
    };
  }

  // state.terminated.reason === 'Error' with exitCode != 0
  const termErr = cs.find(
    (c) =>
      c.state?.terminated?.reason === 'Error' &&
      c.state.terminated.exitCode !== undefined &&
      c.state.terminated.exitCode !== 0,
  );
  if (termErr) {
    const term = termErr.state!.terminated!;
    return { state: 'crit', reason: 'Error', message: term.message, exitCode: term.exitCode, restarts };
  }

  if (pod.phase === 'Failed') {
    return { state: 'crit', reason: 'Failed', restarts };
  }

  // ---- 2. gone ----
  if (pod.phase === 'Succeeded') return { state: 'gone', reason: 'Completed', restarts };
  if (pod.deletionTimestamp) return { state: 'gone', reason: 'Terminating', restarts };

  // ---- 3. warn ----
  if (pod.phase === 'Pending') {
    const since = pod.pendingSince ?? now;
    if (now - since > CONFIG.PENDING_WARN_SECONDS * 1000) {
      return { state: 'warn', reason: 'PendingTooLong', restarts };
    }
  }

  if (restarts >= CONFIG.RESTART_WARN_COUNT) {
    return { state: 'warn', reason: 'RestartsClimbing', restarts };
  }

  if (pod.phase === 'Running' && cs.some((c) => c.ready === false)) {
    return { state: 'warn', reason: 'ProbeFailing', restarts };
  }

  // ---- 4. ok ----
  return { state: 'ok', restarts };
}
