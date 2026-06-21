// Crash reason extraction (FUNCTIONAL_SPEC §8). Pure. Populated purely from pod status —
// no `describe` call. Absent for healthy pods (incl. pods with a *benign* terminated lastState,
// e.g. reason 'Completed' / exitCode 0 from a normal restart or a finished sidecar).

import { highlightAll } from './logTokens';
import type {
  ContainerStatusLike,
  PodCrash,
  PodStatusLike,
  TerminatedStateLike,
} from './types';

const CRIT_WAITING_REASONS = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerError',
  'CreateContainerConfigError',
  'RunContainerError',
]);

/** A termination is "abnormal" (crash-worthy) if it has a non-zero exit code or a non-benign
 *  reason. 'Completed' / exitCode 0 is a normal exit and must NOT produce a crash block. */
function abnormalTerm(t?: TerminatedStateLike): boolean {
  if (!t) return false;
  if (t.exitCode !== undefined && t.exitCode !== 0) return true;
  if (t.reason && t.reason !== 'Completed') return true;
  return false;
}

function crashContainer(pod: PodStatusLike): ContainerStatusLike | undefined {
  const cs = pod.containerStatuses ?? [];
  return (
    cs.find((c) => c.state?.waiting?.reason && CRIT_WAITING_REASONS.has(c.state.waiting.reason)) ??
    cs.find((c) => abnormalTerm(c.lastState?.terminated)) ??
    cs.find((c) => abnormalTerm(c.state?.terminated))
  );
}

/**
 * @param pod      pod status
 * @param prevLogs raw previous-container log lines (the `--previous` equivalent). The provider
 *                 supplies these; this function highlights them.
 * @returns PodCrash, or undefined for a healthy pod / benign termination.
 */
export function extractCrash(pod: PodStatusLike, prevLogs: string[] = []): PodCrash | undefined {
  const c = crashContainer(pod);
  if (!c) return undefined;

  const waiting = c.state?.waiting?.reason;
  const lastTerm = c.lastState?.terminated;
  const curTerm = c.state?.terminated;

  // reason: waiting reason if present, else the abnormal terminated reason.
  const reason =
    waiting ??
    (abnormalTerm(lastTerm) ? lastTerm?.reason : undefined) ??
    (abnormalTerm(curTerm) ? curTerm?.reason : undefined);
  if (!reason) return undefined;

  const term = abnormalTerm(lastTerm) ? lastTerm : abnormalTerm(curTerm) ? curTerm : lastTerm;
  // Surface the underlying terminated reason separately when it differs from the (waiting) reason,
  // e.g. reason 'CrashLoopBackOff' with exitReason 'OOMKilled'.
  const exitReason = term?.reason && term.reason !== reason ? term.reason : undefined;
  return {
    reason,
    exitReason,
    exitCode: term?.exitCode,
    message: term?.message ?? c.state?.waiting?.message,
    previousLogs: highlightAll(prevLogs),
  };
}
