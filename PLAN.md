# PLAN — Hexwall POC

**All milestones complete — `npm run verify` is green.** See `PROGRESS.md` for the final summary.
Build order followed the milestones in `CLAUDE.md`. Each milestone: implement → test → green → next.

## M0 Scaffold
- [ ] npm workspaces root; `packages/shared|server|web`; `e2e/`
- [ ] tsconfig (strict, single root typecheck), ESLint flat config, Prettier
- [ ] Vitest config (coverage v8), Playwright config
- [ ] npm scripts: `dev typecheck lint test test:e2e build verify`
- [ ] `npm install` clean

## M1 Shared logic + tests (test-first, ≥90%)
- [ ] `types.ts` (authoritative shapes from ARCH §4)
- [ ] `config.ts` (CONFIG constants, FUNCTIONAL_SPEC §10)
- [ ] `logTokens.ts` (`highlight`) + table tests (§7 / TEST_PLAN §2)
- [ ] `podState.ts` (`classifyPod`) + state-machine tests (§2)
- [ ] `nodeHealth.ts` (`deriveNodeHealth`) + boundary tests (§3)
- [ ] `rollup.ts` (`computeBox`, `sortBoxes`) + worked-table tests (§4.1) + sort test (§6)
- [ ] `fold.ts` / `engine.ts` (`RollupEngine`, hysteresis, injected clock) + tests (§5/§5.1)
- [ ] `crash.ts` (`extractCrash`) + tests (§8)
- [ ] index barrel

## M2 MockProvider + server
- [ ] `provider.ts` (ClusterProvider interface, no write method)
- [ ] `fixtures.ts` (canonical `prod-eks-use1` 53 nodes; `big` fixture; crash pod; timeline)
- [ ] `mockProvider.ts` (injectable clock, timeline `advanceTo`)
- [ ] `kubeProvider.ts` (read-only, @kubernetes/client-node, injectable client)
- [ ] server (`buildServer`) + routes (snapshot, stream SSE, node, pod, pod logs SSE, healthy)
- [ ] test-hook GET endpoint (env-gated) + static web serving (env-gated)
- [ ] integration tests (zod schemas, snapshot correctness, SSE timeline, read-only guard)
- [ ] KubeProvider read-only spy test

## M3 Web app
- [ ] `api.ts` (REST + SSE client)
- [ ] `Hex`, `NodeBox`, `Wall` (L1) + folded pill + healthy reveal
- [ ] `Honeycomb`, `NodeDetail` (L2) + resource bars + condition chips
- [ ] `PodDetail` (L3) crash-first + highlighted logs + events
- [ ] SSE live updates; no mutation UI anywhere

## M4 E2E + polish
- [ ] Playwright journeys 1–9 (TEST_PLAN §4) + screenshots into `e2e/__screens__`
- [ ] coverage gates; fix until `npm run verify` green
- [ ] adversarial multi-agent review (spec conformance + read-only + completeness)

## M5 KubeProvider path
- [ ] compiles, typed, selectable via `HEXWALL_PROVIDER=kube`, read-only proven by test

## Done
`TEST_PLAN §5` fully checked + `npm run verify` green + app runs + click-throughs work.
