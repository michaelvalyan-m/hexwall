# KICKOFF PROMPT

Copy everything in the fenced block below and paste it as your first message in a Claude Code
session opened in this repository's root.

---

```
You are the lead engineer building the Hexwall POC in this repository. This is an
autonomous build: work through it end to end and do not stop until it is done and tested.

STEP 1 — READ THE SPEC
Read these files completely before writing code, in this order:
  README.md, CLAUDE.md, docs/PRD.md, docs/ARCHITECTURE.md, docs/FUNCTIONAL_SPEC.md,
  docs/UI_SPEC.md, docs/MOCK_SCENARIOS.md, docs/TEST_PLAN.md.
docs/FUNCTIONAL_SPEC.md is the source of truth. Do not implement behavior that contradicts
the docs. If something is ambiguous, pick the most reasonable interpretation consistent with
the docs, record it in DECISIONS.md, and proceed — do not stop to ask.

STEP 2 — PLAN
Write PLAN.md: the milestones M0–M5 from CLAUDE.md, each broken into a concrete checklist.
Create PROGRESS.md and DECISIONS.md and keep them updated as you work.

STEP 3 — BUILD, TEST-FIRST
Build milestone by milestone. For the pure logic in packages/shared, write the unit tests
FIRST from the worked tables in docs/FUNCTIONAL_SPEC.md §4.1 and docs/TEST_PLAN.md §2, then
make them pass. Implement the stack in docs/ARCHITECTURE.md §3 (TypeScript strict, npm
workspaces, Fastify + SSE, React + Vite, Vitest, Playwright). Default to the MockProvider so
everything runs and is testable with no AWS account or live cluster.

After each milestone, run `npm run verify` and keep it green before moving on. Self-verify by
actually running the app (`npm run dev`), exercising the endpoints, running Playwright, and
inspecting the screenshots it writes to e2e/__screens__. Green unit tests alone are not "done."

HARD RULES (do not violate):
  - READ-ONLY. No code path may mutate a cluster. The ClusterProvider interface has no write
    method; the server exposes no mutating cluster routes; KubeProvider issues only read verbs
    and reads logs; the UI has no edit/scale/delete/restart/apply control. Prove it with the
    guard test in docs/TEST_PLAN.md §3.
  - No "more errors than normal"/ML log anomaly detection — deterministic signals + regex
    token highlighting only.
  - Determinism in tests: inject the clock for the timeline/hysteresis; don't assert on random
    placement; fix seeds.

STEP 4 — DEFINITION OF DONE
You are done only when EVERY box in docs/TEST_PLAN.md §5 is checked AND `npm run verify` is
green AND `npm run dev` runs with the mock cluster and the wall → node-detail → pod-detail
click-through works. Every rule in FUNCTIONAL_SPEC must have a test, every endpoint an
integration test, every UI journey an e2e assertion (docs/TEST_PLAN.md §6).

Keep working through failures — fix and re-run rather than stopping — until the gate is green.
Only stop early if genuinely blocked by something outside your control (e.g. a required
package cannot be installed); if so, state exactly what is blocking, what you tried, and what
remains.

When finished, write a final summary in PROGRESS.md: what was built, how to run it, the test
results, and any decisions recorded in DECISIONS.md. Then report the acceptance checklist with
every box checked.

Begin now with STEP 1.
```
