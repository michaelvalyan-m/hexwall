# Test Plan — Hexwall

"Tested every aspect" is operationalized here. The build is **not done** until every box in
§5 is checked and `npm run verify` is green. Prefer writing the unit tests for the pure logic
(§7 of the functional spec) **first**, from the worked tables — they are the spine.

---

## 1. Layers

- **Unit (Vitest)** — pure logic in `packages/shared`: rollup math, node-health classifier,
  pod-state machine, fold + hysteresis, sort, log tokenizer, crash extraction. No I/O.
- **Integration (Vitest)** — the server with `MockProvider`: endpoint shapes (validated with
  `zod`), snapshot correctness, SSE emits on timeline ticks, read-only route guard.
- **E2E (Playwright)** — the running app (web + server, mock provider): the user journeys and
  the visual states from `UI_SPEC` and `MOCK_SCENARIOS`.

Coverage: `packages/shared` core modules must hit **≥ 90%** lines/branches
(`@vitest/coverage-v8`). Overall project ≥ 75%.

---

## 2. Unit tests (must include, at minimum)

- **Rollup table:** every row of `FUNCTIONAL_SPEC §4.1` → assert `litHexes`, `litSeverity`,
  `hexes`, `affectedPct`. Include the `gone`-excluded row and the 0-pod row.
- **Round-up property:** for any `active > 0` with `affected >= 1`, `litHexes >= 1` (problems
  never hide). Property-style test across many counts.
- **Node-health classifier:** a case per threshold boundary (e.g. mem 84→ok, 85→warn, 94→warn,
  95→crit; disk 79/80/89/90; cpu 90; `requestPct` 100; each pressure condition; NotReady).
  Assert `worst()` wins when multiple signals fire.
- **Independence:** a node with all-crit pods but `nodeHealth ok` stays `ok`; a node with all
  `ok` pods but `DiskPressure` is `crit`. (The fold edge case.)
- **Pod-state machine:** CrashLoopBackOff→crit, OOMKilled+restarts→crit, ImagePullBackOff→crit,
  Pending<120s→ok, Pending>120s→warn, restarts≥3→warn, probe-failing→warn, Succeeded→gone,
  Terminating→gone, Running+Ready→ok.
- **Fold + hysteresis:** with an injected clock — node becomes eligible, not folded before 45s,
  folded at/after 45s; a problem un-folds **immediately**.
- **Sort:** given the 5 fixture boxes (order-shuffled input), assert the exact output order
  from `MOCK_SCENARIOS §1`.
- **Log tokenizer:** table of input→spans — including `OOMKilled` as one crit span (not
  `oom`+plain), `503`/`500` crit, `404` warn, `panic` crit, `ERROR`/`timeout` warn, a plain
  line yields a single plain span, empty string doesn't throw.
- **Crash extraction:** from the fixture pod status → `reason='CrashLoopBackOff'`,
  `exitCode=137`, `previousLogs` highlighted; healthy pod → `crash` undefined.

## 3. Integration tests (server + MockProvider)

- `GET /api/snapshot` matches the `ClusterSnapshot` zod schema; `healthyFolded === 48`;
  `boxes.length === 5`; box order equals the expected sort.
- `GET /api/node/ip-10-0-7-30` returns 20 pods with 12 in `crit`.
- `GET /api/pod/payments/payments-api-...` returns populated `crash` with the right reason/exit
  code and highlighted `previousLogs`.
- `GET /api/healthy` returns 48 nodes.
- **SSE:** subscribing to `/api/stream`, then driving the timeline (t1/t2/t3), yields snapshots
  whose `healthyFolded` goes 48 → 47 → 47 → 48 and where `ip-10-0-6-77` appears then folds per
  the hysteresis rule.
- **Read-only guard:** assert the route table exposes no mutating cluster route
  (no POST/PUT/PATCH/DELETE touching cluster resources); and a `KubeProvider` unit test with a
  spied client asserts only read verbs (`get`/`list`/`watch`/log) are ever called across a
  simulated session.

## 4. E2E tests (Playwright, app on mock provider)

Each is an acceptance journey; assert on visible state (DOM/SVG attributes, text):

1. **Wall renders folded.** Load app → the folded pill reads "48 healthy nodes folded"; exactly
   5 problem boxes are visible.
2. **Quartile colors correct.** `ip-10-0-7-30`'s box shows 3 red hexagons + 1 green;
   `ip-10-0-3-08` shows 1 amber + 3 green.
3. **Border independence.** `ip-10-0-9-12` shows a red/crit **border** with 4 **green**
   hexagons and is present (not folded). `ip-10-0-2-45` shows a neutral border with a red
   hexagon.
4. **Expand rollup → real pods.** Click `ip-10-0-7-30` → node detail shows a honeycomb of 20
   pods with 12 red. Click `ip-10-0-4-91` → 17 pods with 3 red.
5. **Pod detail / crash first.** From `ip-10-0-4-91`, open the crashing pod → the crash block
   appears **above** the logs and shows `CrashLoopBackOff` and `137` / `OOMKilled`; the
   previous logs render with `panic`, `503`, `OOMKilled`, `exit code 137` visibly highlighted
   as crit and `ERROR`/`timeout` as warn.
6. **Healthy reveal.** Click the folded pill → a strip of folded healthy nodes appears; click
   again → it hides.
7. **Live update + hysteresis.** Drive the timeline (a test hook/endpoint may advance the mock
   clock): a new problem box appears immediately at t1; after recovery it remains visible at t2
   and is gone (folded) by t3.
8. **Read-only UI.** Assert there is no edit/scale/delete/restart/apply control anywhere in the
   rendered app.
9. **Screenshots.** Capture wall, node-detail, and pod-detail screenshots into `e2e/__screens__`
   for human review (artifacts, not assertions).

## 5. Acceptance checklist — DEFINITION OF DONE

Do not declare the POC complete until **all** are true:

- [ ] `npm install` succeeds from a clean checkout.
- [ ] `npm run typecheck` passes with `strict` and no `// @ts-ignore` in core logic.
- [ ] `npm run lint` passes.
- [ ] `npm run build` builds server and web with no errors.
- [ ] `npm test` (unit + integration) passes; `packages/shared` core ≥ 90% coverage.
- [ ] `npm run test:e2e` passes all journeys in §4.
- [ ] `npm run verify` (the full chain) is green end to end.
- [ ] `npm run dev` starts the app; the wall is visible at the documented URL with the mock
      cluster; manual click-through of node-detail and pod-detail works.
- [ ] Rollup math matches every row of `FUNCTIONAL_SPEC §4.1`.
- [ ] Fold hysteresis verified (no flicker; problems instant; healthy fold delayed).
- [ ] The four border/hex combinations all render and are asserted.
- [ ] Crash reason + previous logs appear without any `describe`-style call.
- [ ] Log highlighting lights the documented tokens.
- [ ] Read-only proven: no mutating routes, no write verbs, no edit UI.
- [ ] `KubeProvider` compiles and is selectable via `HEXWALL_PROVIDER=kube` (not required to
      run against a live cluster; just present, typed, and read-only).
- [ ] `README.md` documents how to run and test; `DECISIONS.md` records any deviations;
      `PROGRESS.md` shows the milestone log.

## 6. Definition of "tested every aspect"

Every rule in `FUNCTIONAL_SPEC` has at least one unit test; every endpoint in `ARCHITECTURE §5`
has at least one integration test; every journey/visual state in `UI_SPEC` has at least one
e2e assertion; the read-only guarantee has an explicit guard test. If a rule exists without a
test, the work is not finished.
