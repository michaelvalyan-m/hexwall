# Functional Spec — Hexwall

This is the **source of truth**. Every rule here must be implemented as pure functions in
`packages/shared` and covered by unit tests. Thresholds are constants in one place
(`packages/shared/src/config.ts`) so they are tunable and testable.

---

## 1. Color vocabulary

| Severity | Color | Meaning |
|---|---|---|
| `ok` | green `#639922` | healthy |
| `warn` | amber `#EF9F27` | degraded, not down |
| `crit` | red `#E24B4A` | down / failing |
| `gone` | gray `#888780` | completed/terminating — neutral, **not** a problem |

Severity ordering for "take the worst": `crit > warn > ok > gone`. (`gone` never escalates.)

---

## 2. Pod state machine (derive `PodView.state`)

Evaluate in order; first match wins.

1. **`crit`** if any of:
   - `containerStatuses[*].state.waiting.reason` ∈ { `CrashLoopBackOff`, `ImagePullBackOff`,
     `ErrImagePull`, `CreateContainerError`, `CreateContainerConfigError`, `RunContainerError` }
   - `containerStatuses[*].lastState.terminated.reason` ∈ { `OOMKilled`, `Error` } **and**
     `restartCount > 0`
   - `containerStatuses[*].state.terminated.reason === 'Error'` (exitCode ≠ 0)
   - pod `phase === 'Failed'`
2. **`gone`** if `phase` ∈ { `Succeeded` } (completed) or `metadata.deletionTimestamp` set
   (Terminating).
3. **`warn`** if any of:
   - `phase === 'Pending'` for longer than `PENDING_WARN_SECONDS` (default **120s**)
     — i.e. scheduling/stuck.
   - `restartCount >= RESTART_WARN_COUNT` (default **3**) but not currently CrashLooping.
   - a readiness probe is failing: `containerStatuses[*].ready === false` while `phase === 'Running'`.
4. Otherwise **`ok`** (Running and Ready).

`reason`, `message`, `exitCode`, `restarts` are copied from the corresponding container
status for display.

---

## 3. Node health classification (derive `NodeView.health`)

`health = worst(condition signals, utilization signals)`.

**Condition signals → `crit`:**
- `Ready === false` (NotReady)
- any of `MemoryPressure`, `DiskPressure`, `PIDPressure`, `NetworkUnavailable` is `true`

**Utilization signals:**
- `mem.usagePct >= MEM_CRIT` (default **95**) → `crit`; `>= MEM_WARN` (default **85**) → `warn`
- `disk.usagePct >= DISK_CRIT` (default **90**) → `crit`; `>= DISK_WARN` (default **80**) → `warn`
- `cpu.usagePct >= CPU_WARN` (default **90**) → `warn`
- `cpu.requestPct >= 100` → `warn` (node is full on requests; nothing new can schedule even if
  actual CPU is low — this is the requests-vs-usage trap; surface it as a warning and show both
  numbers in node detail)
- `net.lossPct >= NET_WARN` (default **5**) → `warn`

`NodeView.health` is the single worst of all the above. **Node health is independent of pod
state** — do not let failing pods change node health, or vice versa. (This independence is the
whole point; see PRD §2.)

---

## 4. Quartile rollup (derive a `QuartileBox` from a `NodeView`)

Let:
- `active` = pods whose `state !== 'gone'` (exclude completed/terminating from the denominator)
- `affected` = pods whose `state` ∈ { `warn`, `crit` } (within `active`)
- `affectedFraction = active.length === 0 ? 0 : affected / active.length`

Then:
- `litHexes = clamp(ceil(affectedFraction * 4), 0, 4)`
  - **Round up.** Any nonzero fraction lights at least one hexagon. A single bad pod out of 100
    still lights one hexagon — **problems must never hide at overview.** The cost (you can't
    distinguish "1 pod down" from "24% down") is intentional and is resolved by zooming in.
- `litSeverity = anyCrit ? 'crit' : (anyWarn ? 'warn' : 'ok')`
  (worst severity among affected pods; lit hexagons all take this color)
- `hexes` = array length 4 where `hexes[i] = i < litHexes ? litSeverity : 'ok'`
- `affectedPct = round(affectedFraction * 100)`

### 4.1 Worked examples (turn these into a unit-test table)

| pods (ok/warn/crit) | active | affected | fraction | litHexes | litSeverity | hexes |
|---|---|---|---|---|---|---|
| 17 (14/0/3) | 17 | 3 | 0.176 | 1 | crit | `[crit,ok,ok,ok]` |
| 16 (15/0/1) | 16 | 1 | 0.063 | 1 | crit | `[crit,ok,ok,ok]` |
| 20 (8/0/12) | 20 | 12 | 0.600 | 3 | crit | `[crit,crit,crit,ok]` |
| 13 (11/2/0) | 13 | 2 | 0.154 | 1 | warn | `[warn,ok,ok,ok]` |
| 18 (18/0/0) | 18 | 0 | 0.000 | 0 | ok | `[ok,ok,ok,ok]` |
| 4 (0/0/4) | 4 | 4 | 1.000 | 4 | crit | `[crit,crit,crit,crit]` |
| 10 (9/0/1) + 5 completed | 10 | 1 | 0.100 | 1 | crit | `[crit,ok,ok,ok]` (gone excluded) |
| 0 pods | 0 | 0 | 0.000 | 0 | ok | `[ok,ok,ok,ok]` |

The four hexagons are a **rollup that expands** on zoom into the node's real per-pod
honeycomb. They are not four specific pods.

---

## 5. Folding healthy nodes

A node is `foldEligible` when **both**:
- `nodeHealth === 'ok'`, **and**
- `litHexes === 0` (no affected pods).

`ClusterSnapshot.boxes` contains only **non-folded** boxes. `healthyFolded` is the count of
folded nodes. The web app shows `healthyFolded` as a clickable pill that reveals the folded
nodes (via `GET /api/healthy`).

**Critical edge case (must be tested):** a node with all-green pods but a non-`ok` border
(e.g. `DiskPressure`) is **NOT** folded, because `nodeHealth !== 'ok'`. It stays on the wall
with 0 lit hexagons and a colored border — the infra early-warning case.

### 5.1 Fold hysteresis (anti-flicker)

To stop nodes popping in and out of the wall on transient blips:
- A node that becomes `foldEligible` is **not** folded immediately. It must remain continuously
  `foldEligible` for `FOLD_HYSTERESIS_SECONDS` (default **45s**) before it folds.
- A node that becomes non-`foldEligible` (a problem appears) leaves the folded set
  **immediately** (no delay for problems — problems show instantly).
- Implement with a per-node timer/`stableSince` timestamp; the rollup engine takes "now" as a
  parameter so this is deterministically testable (inject a clock).

---

## 6. Sorting the wall

`ClusterSnapshot.boxes` is sorted so the eye lands on what matters:
1. `nodeHealth` severity desc (`crit` boxes before `warn` before `ok`).
2. then `litSeverity` desc, then `litHexes` desc (more widespread first).
3. then `changedAt` desc (most recently changed first).
4. then `id` asc (stable tiebreak).

---

## 7. Log tokenizer / highlighter (`packages/shared/src/logTokens.ts`)

Pure function `highlight(line: string): LogLine` that splits a line into `spans` with
`kind ∈ { plain, warn, crit }`. Matching is case-insensitive. A line may contain multiple
highlighted spans; non-matching text stays `plain`.

**`crit` tokens** (red): `panic`, `fatal`, `segfault`, `OOMKilled`, `oom`, `stacktrace`,
`traceback`, `exit code 137`, `exit code 139`, `signal: killed`, and HTTP status `5xx`
(regex `\b5\d{2}\b`), plus `401`, `403`, `429` (auth/abuse), and `500`,`502`,`503`,`504`.

**`warn` tokens** (amber): `error`, `err`, `failed`, `failure`, `warn`, `warning`, `timeout`,
`timed out`, `refused`, `unavailable`, `retry`, `retrying`, `exception`, and HTTP `4xx`
(regex `\b4\d{2}\b`) except those promoted to crit above.

Rules:
- Longest / most-specific match wins for overlapping tokens (`OOMKilled` as one crit span, not
  `oom` + plain).
- A status code already covered by a word match is highlighted once.
- The function must be deterministic and must not throw on empty/odd input.
- Provide a small table of input→expected-spans cases for tests (see TEST_PLAN §unit).

---

## 8. Crash reason extraction (`PodDetail.crash`)

For a pod that is crashing or recently crashed, populate `crash` **without** any `describe`
call, purely from pod status:
- `reason` = `containerStatuses[*].state.waiting.reason` (e.g. `CrashLoopBackOff`) or, if not
  waiting, `lastState.terminated.reason` (e.g. `OOMKilled`, `Error`).
- `exitCode` = `lastState.terminated.exitCode`.
- `message` = `lastState.terminated.message` if present.
- `previousLogs` = the **last-terminated container's** logs (the `--previous` equivalent),
  highlighted via §7. From `KubeProvider` this is `Log` with `previous: true`; `MockProvider`
  supplies a fixture.

The pod-detail view shows this block **first**, above the live logs, so the answer is on
screen immediately.

`crash` is absent for healthy pods.

---

## 9. Read-only enforcement (HARD REQUIREMENT)

- The `ClusterProvider` interface exposes **no** write method. Adding one is a spec violation.
- The server exposes **no** route that mutates cluster state (no POST/PUT/PATCH/DELETE on
  cluster resources). The server's own `/health` is fine.
- `KubeProvider` must only ever issue read verbs (`get`, `list`, `watch`) and read logs. It
  must never call create/patch/replace/delete on the K8s client.
- **Test:** a guard test (a) asserts the Express/Fastify route table contains no mutating
  cluster routes, and (b) wraps the K8s client (or uses a spy in `KubeProvider`'s unit test) to
  assert no write verb is invoked across a full simulated session. See TEST_PLAN §read-only.

---

## 10. Config constants (single source, all tunable)

`packages/shared/src/config.ts`:

```ts
export const CONFIG = {
  PENDING_WARN_SECONDS: 120,
  RESTART_WARN_COUNT: 3,
  MEM_WARN: 85, MEM_CRIT: 95,
  DISK_WARN: 80, DISK_CRIT: 90,
  CPU_WARN: 90,
  NET_WARN: 5,
  FOLD_HYSTERESIS_SECONDS: 45,
};
```

All thresholds referenced above resolve to these. Tests import `CONFIG` rather than hardcoding.
