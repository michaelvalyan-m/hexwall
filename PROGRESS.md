# PROGRESS — Hexwall

**Status: COMPLETE.** `npm run verify` is green (typecheck → lint → 152 unit/integration tests
with coverage gates → build → 13 Playwright e2e journeys). The app runs (`npm run dev`) and the
node→pod click-through works; screenshots are in `e2e/__screens__/`.

### Post-acceptance UX additions (all tested + reviewed, see DECISIONS D10)
- **Node age badge** on each wall box (how long it's been in its current state; ticks live).
- **Clickable folded-healthy tiles** → zoom straight into any folded node.
- **Scrollable live-log window** (fixed height, internal scroll, follows the tail) — no longer
  grows the page.
- **Dark / light / system theme switch** (React-state only, no localStorage; system tracks the OS).

Two adversarial multi-agent review workflows were run over the build. They confirmed 2 real bugs,
both fixed: `extractCrash` firing on a benign `Completed` termination (D8), and pod-detail
duplicating current-log lines because the SSE tail replayed the REST logs (D9). They also drove
two test-robustness additions (logs-SSE integration test; mixed warn+crit `litSeverity`).

## How to run
```bash
npm install
npm run dev      # → http://localhost:5173 (web) + http://localhost:8080 (api)
npm run verify   # the full gate
```
See `README.md` for the command table and a click-through walkthrough.

## Milestone log

### M0 Scaffold — done
npm workspaces (`shared`/`server`/`web`) + `e2e/`; single root `tsconfig` (strict) for one-shot
typecheck; ESLint flat config; Prettier; Vitest (+v8 coverage with per-file gates); Playwright;
all `npm run` scripts. Server bundles via esbuild; web via Vite; both consume `@hexwall/shared`
as TS source.

### M1 Shared pure logic + tests — done (≥90% on core modules)
`types.ts`, `config.ts` (CONFIG + §1 colors + `worst`), `logTokens.ts` (`highlight`),
`podState.ts` (`classifyPod`), `nodeHealth.ts` (`deriveNodeHealth` + `nodeChip`), `rollup.ts`
(`computeQuartiles`/`computeBox`/`sortBoxes`), `engine.ts` (`RollupEngine`: quartiles + fold +
hysteresis + sort, injected clock), `crash.ts` (`extractCrash`). Tests from the §4.1 worked
table, round-up property, §6 sort, §2 state machine, §3 boundaries, §7 token table, §5.1
hysteresis timeline, §8 crash extraction. An adversarial spec-audit workflow caught one real bug
(`extractCrash` firing on a benign `Completed`/exit-0 lastState) — fixed + regression-tested.

### M2 MockProvider + server — done
`ClusterProvider` interface (no write method); deterministic canonical fixture `prod-eks-use1`
(53 nodes: 48 healthy incl. the timeline subject `ip-10-0-6-77`, + 5 problem nodes; the crashing
`payments-api` pod; the `big` scale fixture); `MockProvider` (injectable clock + scripted
timeline `advanceTo`); read-only `KubeProvider` (typed, injectable client). Fastify server:
`/api/snapshot`, `/api/stream` (SSE), `/api/node/:name`, `/api/pod/:ns/:name`,
`/api/pod/:ns/:name/logs` (SSE), `/api/healthy`, plus env-gated GET test hooks and static web
serving. Integration tests: zod-validated shapes, snapshot correctness (48 folded / 5 boxes /
§6 order), node & pod detail, `/api/healthy`=48, a faithful streaming-SSE timeline test, the
read-only route guard, the KubeProvider read-only spy, and a `big`-fixture perf smoke (<50ms).

### M3 Web app — done
React + Vite + SVG honeycomb. L1 Wall (folded pill + reveal strip + node boxes: border=node
health, 4 quartile hexes, chip, caption), L2 NodeDetail (real per-pod honeycomb + CPU/mem/disk/
net resource bars showing usage **and** request + condition chips), L3 PodDetail (crash block
**first**, then highlighted live logs, then events). Live SSE updates; React-state routing only
(no localStorage/sessionStorage); no mutation control anywhere.

### M4 E2E + polish — done
9 Playwright journeys (TEST_PLAN §4) all green, incl. live-update + hysteresis driven through a
GET test hook, the read-only-UI assertion, and screenshots of wall/node/pod. Coverage gates met.
A final adversarial acceptance-review workflow was run over the whole build.

### M5 KubeProvider — done (optional path)
Compiles, strict-typed, selectable via `HEXWALL_PROVIDER=kube`, proven read-only by a spied unit
test. Not exercised against a live cluster (not required by the gate).

## Acceptance checklist (TEST_PLAN §5) — all satisfied
install ✓ · typecheck (strict, no `@ts-ignore` in core) ✓ · lint ✓ · build ✓ · test + shared
core ≥90% ✓ · e2e journeys ✓ · verify green ✓ · dev runs + click-through ✓ · §4.1 rollup table ✓
· fold hysteresis ✓ · four border/hex combos ✓ · crash + previous logs without `describe` ✓ · log
highlighting ✓ · read-only proven (no mutating routes/verbs/UI) ✓ · KubeProvider compiles +
selectable + read-only ✓ · README/DECISIONS/PROGRESS present ✓

Deviations and resolved ambiguities are recorded in `DECISIONS.md` (notably D1: the wall sort
follows FUNCTIONAL_SPEC §6 — the declared source of truth — where it diverges from the
MOCK_SCENARIOS prose ordering).
