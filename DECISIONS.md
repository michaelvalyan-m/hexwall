# DECISIONS — deviations & resolved ambiguities

Per `CLAUDE.md`, decisions made at ambiguous points, with rationale.

## D1 — Wall sort order: §6 wins over MOCK_SCENARIOS prose
`FUNCTIONAL_SPEC §6` (the declared source of truth) sorts boxes by `nodeHealth` severity
**first**. Applied literally to the 5 fixture boxes that yields:

`ip-10-0-9-12` (crit) → `ip-10-0-4-91` (warn) → `ip-10-0-7-30` (ok/3crit) →
`ip-10-0-2-45` (ok/1crit) → `ip-10-0-3-08` (ok/1warn)

`MOCK_SCENARIOS §1` prose lists `9-12 → 7-30 → 4-91 → 2-45 → 3-08` (it ranks the ok-border
3-crit node above the warn-border node). These conflict. MOCK_SCENARIOS itself says: *"The
agent should compute the exact post-sort order from FUNCTIONAL_SPEC §6 and assert it; the line
above is the expected result of applying those rules."* → I implement §6 verbatim and assert
the §6 order in the unit + integration sort tests. The e2e tests assert per-box content and
presence (which match both readings), not the warn-vs-ok adjacency.

## D2 — `ip-10-0-6-77` is one of the 48 healthy nodes (timeline subject)
MOCK_SCENARIOS §3 calls it a "49th node" but also requires `healthyFolded` to drop 48→47 when
it develops a crit pod — that only works if it was already in the folded healthy set. So it is
node #48 of the healthy set; the timeline mutates its pods (crit at t1, recovered at t2, folded
again by t3). Totals stay 53 nodes throughout. "49th" is read as loose wording.

## D3 — Initial-state nodes fold immediately (no t0 hysteresis wait)
Hysteresis (§5.1) governs nodes that *become* eligible mid-session. On the very first snapshot
the 48 healthy nodes are already eligible, so they fold at t0 (matching `GET /api/snapshot →
healthyFolded === 48`). The engine seeds first-seen eligible nodes as already-stable; only
transitions after seeding wait `FOLD_HYSTERESIS_SECONDS`.

## D4 — Clock & test hooks
The rollup engine takes `now` as a parameter (deterministic). Server reads it from a `Clock`.
- Dev: `RealClock` (Date.now) + an auto looping timeline driver (t0→t1→t2→t3, repeat).
- Tests/e2e: `ManualClock`; integration drives `provider.advanceTo(label)` in-process; e2e uses
  an **env-gated GET** `/api/_test/advance?to=<label>` (GET, so the read-only route guard stays
  trivially strong: no mutating HTTP method is ever registered). Advancing a simulated clock is
  not a cluster mutation.

## D5 — Build/run strategy (minimal deps, runnable artifacts)
- Single root `tsconfig.json` for `typecheck` (one `tsc --noEmit` over all packages).
- Web builds with Vite; server bundles with esbuild (platform=node, packages=external) so the
  built `dist/server.mjs` is node-runnable without ESM-extension churn. `@hexwall/shared` is
  consumed as TS source (tsx/vite/esbuild are TS-aware); no separate shared build step.
- Single origin in e2e: server serves the built web (`@fastify/static`, env-gated) so SSE/fetch
  are same-origin and no CORS is needed. Dev uses Vite with an `/api` proxy for DX.

## D7 — `QuartileBox.chip` added (additive display field)
The wall's node-box header shows a condition chip (`mem 88%`, `disk 96%`, `healthy` — UI_SPEC §2),
which needs the node's metrics, but `ClusterSnapshot.boxes` carries only `QuartileBox` (no
metrics). Rather than have the wall re-fetch every node, I added a derived `chip: string` field to
`QuartileBox`, computed server-side by the pure `nodeChip()` helper in `computeBox()`. This is an
additive extension to the ARCHITECTURE §4 shape; the zod schema and tests were updated to match.

## D8 — Audit-driven fix: `extractCrash` benign-termination guard
An adversarial spec-audit subagent found `extractCrash` (§8) firing a crash block for a *healthy*
pod that merely carries a benign `lastState.terminated` (reason `Completed` / exit 0 — which real
K8s reports for any pod that has ever restarted cleanly). `classifyPod` correctly returns `ok` for
that pod, so the two disagreed, violating §8 ("crash absent for healthy pods"). Fixed by gating the
lastState/terminated branch on an `abnormalTerm()` test (non-zero exit code, or a non-`Completed`
reason). Regression-tested.

## D9 — Log streaming is an append-only live tail (final-review fix)
A final adversarial acceptance-review subagent found pod-detail rendering every current-log line
twice: `GET /api/pod/...` already returns `PodDetail.logs`, and `streamPodLogs` was replaying those
same lines from index 0. Resolved by defining the SSE log stream as the *live tail*: it emits only
**new** lines to append to the REST snapshot (the mock now emits fresh heartbeats; `KubeProvider`
primes its `lastSeen` on the first poll and streams only subsequent deltas). Added an integration
test for `GET /api/pod/:ns/:name/logs` (previously only its route presence was asserted) and a
discriminating unit test for `litSeverity` when warn+crit pods coexist (crit must win).

## D10 — Post-POC UX features (age badge, clickable folded tiles, scrollable logs, theme)
Four features added after acceptance:
- **Node age badge** — each box shows how long it's been in its current state. The engine seeds
  `QuartileBox.changedAt` from an optional `NodeView.stateAgeMs` on first sight (so a node already
  broken for 7h reads "7h", not "0s"); the mock fixture stamps a spread (7h / 1h 10m / 42m / 12m /
  3m). The web computes age as `generatedAt − changedAt + (clientNow − snapshotReceivedAt)` so it's
  anchored to the snapshot's own clock (correct under both the dev `RealClock` and the test
  `ManualClock`) and ticks live via a 1s interval. Seeding does not affect the §6 sort order (the 5
  canonical boxes are distinguished before `changedAt`).
- **Clickable folded-healthy tiles** — the reveal-strip tiles are now buttons that open that node's
  L2 detail.
- **Scrollable log window** — the live-log panel is a fixed-height (`min(46vh,420px)`) internally
  scrollable window that follows the tail (stick-to-bottom unless the user scrolls up), instead of
  growing the page.
- **Theme switch (dark/light/system)** — a floating 3-way control. Per the CLAUDE.md rule, the
  selection lives in **React state only — no localStorage/sessionStorage**; it defaults to *system*
  (tracks `prefers-color-scheme` live via a cleaned-up `matchMedia` listener) and resets on reload.
  Severity colors (§1) are identical across themes; only the neutral chrome variables swap.

A focused adversarial review workflow over all four features + a regression sweep confirmed **0
issues**.

## D6 — Severity colors / e2e assertions
e2e asserts on `data-sev` / `data-health` attributes (semantic) in addition to color, so tests
are robust to exact hex values while UI uses the §1 colors via CSS variables.
