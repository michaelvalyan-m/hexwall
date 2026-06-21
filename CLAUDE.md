# CLAUDE.md — working agreement for this repo

You are building the **Hexwall** POC: a read-only Kubernetes/EKS monitoring wall. The full
design is in [`docs/`](./docs). `docs/FUNCTIONAL_SPEC.md` is the source of truth; build to it.

## Read first (in order)
`docs/PRD.md` → `docs/ARCHITECTURE.md` → `docs/FUNCTIONAL_SPEC.md` → `docs/UI_SPEC.md` →
`docs/MOCK_SCENARIOS.md` → `docs/TEST_PLAN.md`. Re-open them whenever you're unsure; do not
invent behavior that contradicts them.

## How to work (the loop)
1. Produce `PLAN.md`: milestones (below) broken into a checklist.
2. For each milestone: implement → run the relevant tests → fix → repeat until green.
   Update `PROGRESS.md` as you go (what's done, what's next).
3. **Test-first for the pure logic.** Turn the worked tables in `FUNCTIONAL_SPEC §4.1` and the
   token table in `TEST_PLAN §2` into failing unit tests, then make them pass.
4. After each milestone, run `npm run verify` and keep it green before moving on.
5. **Do not stop, and do not ask for confirmation, until the entire acceptance checklist in
   `docs/TEST_PLAN.md §5` passes and `npm run verify` is green.** If you hit a decision point,
   choose the most reasonable option consistent with the docs, record it in `DECISIONS.md`, and
   continue. Only stop early if truly blocked by something outside your control (e.g. a
   required package cannot be installed from the allowed registries) — and if so, say exactly
   what's blocking and what you tried.
6. Self-verify by actually running things: start the app, hit endpoints, run Playwright, and
   look at the screenshots in `e2e/__screens__`. Green unit tests alone are not "done."

## Milestones
- **M0 Scaffold** — npm workspaces; `packages/shared|server|web`; tsconfig (strict), ESLint,
  Prettier, Vitest, Playwright; the `npm run` scripts from `README.md`; CI-style `verify`.
- **M1 Shared logic + tests** — `types.ts`, `config.ts`, `rollup.ts` (pod-state, node-health,
  quartile, fold+hysteresis, sort), `logTokens.ts`, crash extraction. Unit tests from the
  tables. Hit ≥90% on these modules.
- **M2 MockProvider + server** — implement `ClusterProvider`, `MockProvider` with the canonical
  fixture and the scripted timeline (injectable clock), the REST routes, and SSE. Integration
  tests. Read-only guard test.
- **M3 Web app** — Wall (folded pill + node boxes + 4 quartile hexes), node-detail honeycomb +
  resource bars, pod-detail (crash block first + highlighted logs + events). SSE live updates.
  No mutation UI anywhere.
- **M4 E2E + polish** — Playwright journeys from `TEST_PLAN §4`, screenshots, coverage, fix
  everything until `verify` is green and the whole §5 checklist is checked.
- **M5 KubeProvider (optional path)** — implement against `@kubernetes/client-node`, read-only
  only, selectable via env. Must compile and be typed; not required to run against a real
  cluster.

## Commands (implement these as the canonical scripts)
- `npm run dev` — server + web (mock provider), print the URL.
- `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:e2e` · `npm run build`
- `npm run verify` — `typecheck && lint && test && build && test:e2e` (the gate).

## Guardrails (non-negotiable)
- **Read-only.** No code path may mutate a cluster. The provider interface has no write method;
  the server has no mutating cluster routes; `KubeProvider` issues only read verbs and reads
  logs. There is no edit/scale/delete/restart/apply control in the UI. This is enforced by a
  test (`FUNCTIONAL_SPEC §9`, `TEST_PLAN §3`).
- **No anomaly/ML log detection** in the POC — deterministic signals + regex highlighting only
  (`PRD §5`).
- **Mock-first.** Everything must build, run, and be tested with `MockProvider` and no AWS
  account. The real path is additive.
- **Minimal dependencies.** Prefer the stack in `ARCHITECTURE §3`. Don't add heavy frameworks.
  No browser `localStorage`/`sessionStorage` in the web app's core state — use React state.
- **Determinism in tests.** Inject the clock; don't assert on random placement; fix seeds.
- **Keep pure logic I/O-free** in `packages/shared` so it stays unit-testable.
- **Commit** in logical steps with clear messages (if git is available).

## Done
Done = `docs/TEST_PLAN.md §5` fully checked **and** `npm run verify` green **and** the app runs
and click-throughs work. Then write a short summary in `PROGRESS.md` of what was built and how
to run it. Until then, keep going.
