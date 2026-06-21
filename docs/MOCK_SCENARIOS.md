# Mock Scenarios — Hexwall

`MockProvider` serves a **deterministic** cluster so the whole app runs and is fully testable
offline. Tests import these expected values. Do not randomize anything that a test asserts on
(a fixed seed is fine for purely cosmetic placement).

---

## 1. Canonical fixture: cluster `prod-eks-use1`

**53 nodes total: 48 healthy (foldable) + 5 problem nodes.**

The 48 healthy nodes: `nodeHealth = ok`, all pods `ok`, ~12–20 pods each → all `foldEligible`
→ after hysteresis they fold into `healthyFolded = 48`.

The 5 problem nodes (these mirror the four meaningful UI combinations plus the widespread case):

| id | nodeHealth | condition chip | pods (ok/warn/crit) | expected litHexes | litSeverity | folded? |
|---|---|---|---|---|---|---|
| `ip-10-0-4-91` | warn | `mem 88%` | 14 / 0 / 3 | 1 | crit | no |
| `ip-10-0-2-45` | ok | `healthy` | 15 / 0 / 1 | 1 | crit | no (has a crit pod) |
| `ip-10-0-7-30` | ok | `healthy` | 8 / 0 / 12 | 3 | crit | no |
| `ip-10-0-3-08` | ok | `healthy` | 11 / 2 / 0 | 1 | warn | no |
| `ip-10-0-9-12` | crit | `disk 96%` | 18 / 0 / 0 | 0 | ok | **no** (border is crit) |

Node-health inputs that must produce the above (so the §3 classifier is exercised):
- `ip-10-0-4-91`: `mem.usagePct = 88` (→ warn), no pressure conditions.
- `ip-10-0-9-12`: `disk.usagePct = 96` **and** `DiskPressure = true` (→ crit).
- the three `ok` nodes: all utilization below warn thresholds, no pressure, `Ready = true`.

`ClusterSnapshot.boxes` after fold+sort must be, in order:
`ip-10-0-9-12` (crit border) → `ip-10-0-7-30` (3 red) → `ip-10-0-4-91` (warn border, 1 red) →
`ip-10-0-2-45` (ok border, 1 red) → `ip-10-0-3-08` (ok border, 1 amber)
(crit border first; then among ok-border boxes, more-widespread/crit before warn).

> The agent should compute the exact post-sort order from `FUNCTIONAL_SPEC §6` and assert it;
> the line above is the expected result of applying those rules.

---

## 2. The crashing pod (drives pod-detail tests)

On node `ip-10-0-4-91`, one of the 3 crit pods is the detail target:

- name: `payments-api-7f9c8b6d4-q2x9z`, namespace `payments`, workload `payments-api`
- `state = crit`, `reason = CrashLoopBackOff`, `restarts = 8`
- `lastState.terminated`: `reason = OOMKilled`, `exitCode = 137`
- `PodDetail.crash` must be populated:
  - `reason = 'CrashLoopBackOff'`, `exitCode = 137`
  - `previousLogs` from this fixture (highlighted):

```
2026-06-20T11:02:13Z INFO  starting payments-api v1.8.2
2026-06-20T11:02:14Z INFO  connected to postgres
2026-06-20T11:03:01Z ERROR upstream returned 503 from inventory-svc
2026-06-20T11:03:01Z WARN  retrying request (attempt 2) ... timeout
2026-06-20T11:03:09Z ERROR unhandled exception in worker pool
2026-06-20T11:03:09Z panic: runtime: out of memory
2026-06-20T11:03:09Z signal: killed (exit code 137 / OOMKilled)
```

Expected highlight assertions (subset): `503` → crit span, `panic` → crit span,
`OOMKilled` → crit span, `exit code 137` → crit span, `ERROR` → warn span,
`timeout` → warn span, `retrying` → warn span.

- Events for this pod must include: `Warning` / `BackOff` / "Back-off restarting failed
  container" and `Warning` / `Unhealthy` / liveness probe text.

A **healthy** pod on `ip-10-0-2-45` (e.g. `web-...`) must return `PodDetail` with `crash`
**absent** and benign logs (no crit spans) — to test the negative case.

---

## 3. Live timeline (drives SSE + hysteresis tests)

`MockProvider` plays a scripted timeline (advanced by an injectable clock so tests are
deterministic; in `npm run dev` it advances on a real interval, e.g. every 3s):

- **t0:** the fixture above (5 problem nodes, 48 folded).
- **t1 (+5s):** a 49th node `ip-10-0-6-77` develops 1 crit pod → it must appear on the wall
  **immediately** (problems show with no hysteresis), `healthyFolded` drops to 47.
- **t2 (+10s):** `ip-10-0-6-77` recovers (pod healthy again) → it is now `foldEligible` but
  must **remain visible** for `FOLD_HYSTERESIS_SECONDS` (45s) before folding back.
- **t3 (+60s):** `ip-10-0-6-77` has been stable past the hysteresis window → it folds,
  `healthyFolded` returns to 48.

Tests drive the clock to t1/t2/t3 and assert presence/absence + `healthyFolded`.

---

## 4. Scale check fixture (optional but recommended)

A second selectable fixture `big` with ~400 nodes (mostly healthy, a handful of problems) to
verify the fold keeps the rendered box count small and the snapshot/serialize stays fast
(< 50ms to build). Used by a performance smoke test, not by the core acceptance e2e.

---

## 5. Provider selection

- Default: `MockProvider` (fixture `prod-eks-use1`).
- `HEXWALL_FIXTURE=big` selects the scale fixture.
- `HEXWALL_PROVIDER=kube` selects `KubeProvider` (needs a kubeconfig; not used by tests).
