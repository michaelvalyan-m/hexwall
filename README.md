# Hexwall

> Working codename. A **read-only** Kubernetes / EKS monitoring wall. You glance at it the
> way you glance at a weather map — colored hexagons and boxes — and problems glow at you
> before you read a single line of text. It never edits the cluster; it only watches.

The proof-of-concept is **built**. `npm install` then `npm run dev` brings up the wall against a
deterministic mock cluster; `npm run verify` runs the full gate (typecheck → lint → unit +
integration → build → e2e) and is green. See **[Running the POC](#running-the-poc)** below and
[`PROGRESS.md`](./PROGRESS.md) for what was built. The original design specs live in
[`docs/`](./docs) and remain the source of truth.

---

## What is being built (one paragraph)

A monitoring dashboard for Kubernetes clusters (EKS first). The overview is a "wall" of
boxes. Each box is a node (or a workload), its **border color** encodes node health
(CPU / memory / disk / network pressure), and inside it are **four hexagons**, each
representing 25% of that node's pods. A lit hexagon means up to a quarter of the pods are in
an abnormal state. Nodes that are completely healthy (green border **and** no abnormal pods)
are folded away into a single clickable count, so the wall is mostly empty until something
breaks. You can semantically **zoom** from the whole cluster, to a node's real per-pod
honeycomb, down to a single pod's logs — with error tokens (`panic`, `5xx`, `OOMKilled`,
exit codes) highlighted and the crash reason pulled to the top so you never have to run
`kubectl describe` yourself. The tool is strictly read-only.

The full design lives in [`docs/`](./docs). Read it in this order:

1. [`docs/PRD.md`](./docs/PRD.md) — product vision, users, scope, non-goals
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — components, data model, provider interface, tech stack
3. [`docs/FUNCTIONAL_SPEC.md`](./docs/FUNCTIONAL_SPEC.md) — the exact rules (rollup math, health thresholds, log tokens). **The source of truth.**
4. [`docs/UI_SPEC.md`](./docs/UI_SPEC.md) — zoom ladder, box anatomy, colors, interactions
5. [`docs/MOCK_SCENARIOS.md`](./docs/MOCK_SCENARIOS.md) — deterministic fixtures the tests assert against
6. [`docs/TEST_PLAN.md`](./docs/TEST_PLAN.md) — test strategy + the acceptance checklist (definition of done)
7. [`CLAUDE.md`](./CLAUDE.md) — working conventions, commands, the autonomous loop, guardrails

---

## How to start the build

1. Drop this folder somewhere on disk.
2. Open a Claude Code session **in this directory**.
3. Paste the contents of [`KICKOFF_PROMPT.md`](./KICKOFF_PROMPT.md) as your first message.

That prompt tells the agent to read the docs, write a plan, and build/test in a loop until
the acceptance criteria in `docs/TEST_PLAN.md` all pass. `CLAUDE.md` is loaded automatically
and reinforces the same rules.

---

## Intended commands (the agent will implement these as npm scripts)

| Command | Purpose |
|---|---|
| `npm install` | install workspace deps (Node 20+, npm workspaces) |
| `npm run dev` | run the server + web app locally (mock provider by default) |
| `npm run typecheck` | strict TypeScript, no errors allowed |
| `npm run lint` | ESLint |
| `npm test` | unit + integration (Vitest) |
| `npm run test:e2e` | end-to-end (Playwright) |
| `npm run verify` | **the gate:** typecheck → lint → test → build → test:e2e |

"Done" = `npm run verify` is green **and** every box in `docs/TEST_PLAN.md` is checked.

---

## Running the POC

Requires **Node 20+** (developed on Node 22). From the repo root:

```bash
npm install            # install workspace deps
npm run dev            # server (mock provider) + Vite web UI → http://localhost:5173
```

Open http://localhost:5173: you'll see the wall with **48 healthy nodes folded** and the 5 problem
nodes. Click a problem node → its per-pod honeycomb + resource bars. Click a red pod hex (e.g. the
crashing `payments-api` pod on `ip-10-0-4-91`) → the crash block (`CrashLoopBackOff · exit 137
(OOMKilled)`) with highlighted previous-container logs. Click the green pill → the folded healthy
nodes. In dev the mock timeline loops, so a node periodically pops onto the wall and folds back.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | server + web (mock provider); prints the URLs |
| `npm run typecheck` | strict TypeScript across all packages (one `tsc --noEmit`) |
| `npm run lint` | ESLint (flat config) |
| `npm test` | unit + integration (Vitest) with v8 coverage |
| `npm run build` | Vite build (web) + esbuild bundle (server) |
| `npm run test:e2e` | Playwright journeys (builds web, serves it single-origin) |
| `npm run verify` | **the gate:** typecheck → lint → test → build → test:e2e |

E2E screenshots land in [`e2e/__screens__/`](./e2e/__screens__). The real cluster path is
optional and selected with `HEXWALL_PROVIDER=kube` (needs a kubeconfig; read-only verbs only) —
it compiles and is proven read-only by a unit test but is not exercised by the acceptance gate.
Scale fixture: `HEXWALL_FIXTURE=big`.

## Two things to know about scope

- **Mock-first.** The POC defaults to a deterministic in-memory cluster (`MockProvider`) so it
  runs and is fully testable with no AWS account and no live cluster. A real `KubeProvider`
  (via `@kubernetes/client-node`) is implemented and selectable but is **not** required for the
  acceptance gate.
- **Read-only is a hard requirement, not a default.** No code path may mutate the cluster. A
  test asserts that no write verb is ever issued. See `docs/FUNCTIONAL_SPEC.md` §9.
