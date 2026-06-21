# PRD — Hexwall

## 1. Problem

Operators of Kubernetes clusters (EKS in particular) lack a glanceable, ambient view of
cluster health. Existing dashboards are dense tables, or powerful-but-heavy paid agents, or
general IDEs that require you to already know where to look. When something breaks, the
workflow is: notice an alert, open a terminal, `kubectl get pods`, find the bad one,
`kubectl describe pod`, `kubectl logs`, `kubectl logs --previous`, mentally parse the crash
reason. That is slow and requires expertise.

## 2. Product idea

A **read-only monitoring wall** that you read like a weather map. From across the room you can
tell whether the cluster is healthy by color alone. When something is wrong it glows, and you
**zoom in** progressively — cluster → node → pod — until the answer (crash reason + the
relevant log lines) is on screen, without typing a single command.

The defining visual is the **honeycomb**: pods are hexagons grouped into boxes. Two
independent layers of color carry the meaning:

- **Box border = node health** (CPU / memory / disk / network pressure).
- **Hexagons = pod state** (healthy / warning / critical / completed).

Keeping the two layers independent is the core insight: a green-bordered box full of red
hexagons means *the node is fine, your app is broken* (page the app team); a red-bordered box
full of green hexagons means *the node is under pressure but the pods are still up* (an infra
early warning). A single blended color would destroy that distinction.

## 3. Target users

- **SREs / platform engineers** running shared clusters — live primarily in the node/infra lens.
- **Application developers** — care about "is my service healthy," live primarily in the
  workload lens.
- **On-call responders** — want the wall on a screen and the crash reason one click away.
- **Security-conscious orgs** — the read-only model needs only a read-only `ClusterRole`,
  which is an easy approval. This is a deliberate adoption wedge.

## 4. Core capabilities (what the POC must demonstrate)

1. **Glance** — a cluster wall where overall health is legible by color in under a second.
2. **Fold the healthy** — completely-healthy nodes collapse into a single count so only
   problems are rendered.
3. **Quartile rollup** — every box shows four hexagons (each = 25% of pods); the number lit
   reflects how widespread the problem is, and a single bad pod still lights one hexagon so
   problems never hide.
4. **Semantic zoom** — cluster → node (real per-pod honeycomb + resource bars) → pod.
5. **Pod detail without `kubectl`** — logs with error tokens highlighted, and for a crashing
   pod the crash reason, exit code, and previous-container logs pulled to the top.
6. **Strictly read-only** — never mutates the cluster.

## 5. Explicit non-goals (out of scope for the POC)

- **No mutation of any kind.** No editing manifests, scaling, deleting, cordoning, applying.
  Read and watch only.
- **No "more errors than normal" log anomaly detection.** Baseline-relative anomaly detection
  is genuinely hard and produces false positives that destroy trust. The POC ships only
  *deterministic* signals (CrashLoopBackOff, OOMKilled, ImagePullBackOff, restart counts,
  probe failures, pressure conditions) and *regex* highlighting of known error tokens. Anomaly
  detection is noted as future work, nothing more.
- **No alerting / paging integrations** (PagerDuty, Slack) in the POC.
- **No historical time-series storage** beyond what is needed to (a) persist Events, which
  age out of the API after ~1h, and (b) drive the fold hysteresis. No long-term metrics DB.
- **No auth/SSO/multi-tenant** in the POC — single local user.
- **No requirement to connect to a real cluster** for acceptance — see ARCHITECTURE
  (mock-first). The real EKS path is built but optional.

## 6. Why now / differentiation (context, not a build requirement)

Datadog ships a hexagonal host map (the metaphor is proven and loved) but behind a heavy paid
agent; Weave Scope did topology and is archived; Komodor focuses on "what changed"; Lens /
Headlamp / K9s are general dashboards. None combine *glanceable quartile rollup + fold the
healthy + two-layer color + pre-fetched crash reason* behind a read-only, zero-config install.
That combination is the product.

## 7. Success criteria for the POC

The POC is a success when a user can run `npm run dev`, see the mock cluster's wall with the
healthy nodes folded and the five problem nodes rendered correctly, zoom into a crashing node,
open the crashing pod, and read its crash reason and highlighted logs — and when
`npm run verify` (full test suite, including e2e assertions of all of the above) is green.
See `docs/TEST_PLAN.md` for the exact checklist.
