# Platform Model — Tessera (umbrella) / Hexwall (EKS leaf)

> Read alongside `ARCHITECTURE.md` and `FUNCTIONAL_SPEC.md`. This doc defines the **universal**
> model that the single-EKS POC must slot into without rework. The EKS honeycomb is the *leaf
> renderer* for one kind of cell in a much larger zoomable map.

## 1. The one idea

The whole system is a **single recursive tree of Cells** rendered as **one zoomable map**.
Every level is the same shape: a thing that has a health rollup, contains children, and can be
opened to reveal them.

```
estate (your whole cloud footprint)            ← the world
  └─ provider   (AWS, GCP, Azure, on-prem)      ← continents
       └─ account  (AWS account / GCP project / Azure subscription)   ← countries
            └─ service  (EKS, Lambda, RDS, GKE, Cloud Run, EC2 …)      ← cities
                 └─ resource  (a specific cluster / function / db)     ← districts/buildings
                      └─ … leaf-specific subtree …                     ← streets/rooms
                            (EKS:  node → pod ;  Lambda: function → invocation class ; …)
```

You zoom the map in/out across these levels. High levels render as **pulsating severity
circles**; the EKS `resource` leaf renders as the **honeycomb wall** we already designed. It is
all one map.

## 2. Naming taxonomy (LOCK THIS)

| Depth | `level` (canonical, constant) | Map metaphor | Display label by provider |
|---|---|---|---|
| 0 | `estate` | world | — |
| 1 | `provider` | continent | AWS / GCP / Azure / on-prem |
| 2 | `account` | country | **Account** (AWS) · **Project** (GCP) · **Subscription** (Azure) |
| 3 | `service` | city | the service category (EKS, Lambda, RDS, …) |
| 4 | `resource` | district / building | a specific instance (e.g. `prod-eks-use1`) |
| 5+ | leaf-specific | streets / rooms | EKS: `node`, `pod`, `workload`; Lambda: `function`; … |

**Rules:**
- The generic hierarchical unit is a **`Cell`**. Every map element — continent or pod — is a
  `Cell`. (On theme: cells within cells; a pod is already a hexagonal cell.)
- **Reserve the word `Node` exclusively for the Kubernetes worker machine.** Never use "node"
  for tree/graph/map units — use `Cell`. This avoids the single worst naming collision in the
  project.
- `level` values are **canonical and constant**; only the human **label** varies per provider
  (account/project/subscription). UI strings come from `cell.label`, never hardcoded.
- Don't bake EKS or k8s assumptions into anything above the `resource` leaf.
- Avoid overloading `service`: at L3 it means "a cloud service category." The Kubernetes
  `Service` object, if ever surfaced inside the EKS leaf, is always qualified "Kubernetes
  Service."

## 3. The universal `Cell` and `Rollup` types

These supersede the EKS-flat shapes in `ARCHITECTURE §4` — the EKS data becomes a *subtree* of
this. `Severity` is unchanged from `FUNCTIONAL_SPEC §1` (`ok | warn | crit | gone`).

```ts
export type Level =
  | 'estate' | 'provider' | 'account' | 'service' | 'resource'
  | 'node' | 'pod' | 'workload'        // EKS leaf levels
  | string;                            // open for future leaf kinds (e.g. 'function')

export interface Rollup {
  severity: Severity;                  // worst (weighted) across the subtree
  total: number;                       // count of descendant LEAF units (e.g. pods)
  affected: number;                    // descendant leaf units in warn|crit
  affectedFraction: number;            // affected / total (0 if total 0)
  intensity: number;                   // 0..1 — drives pulsation (see §5)
  bySeverity: Record<Severity, number>;// counts per severity across the subtree
}

export interface Cell {
  id: string;                          // global path id (see §6)
  level: Level;
  kind: string;                        // 'aws' | 'eks' | 'lambda' | 'node' | 'pod' | ...
  label: string;                       // display name (honors project/subscription)
  provider?: string;                   // 'aws' | 'gcp' | 'azure' | ...
  rollup: Rollup;                      // recursive health summary
  renderKey?: string;                  // which renderer: undefined => generic map cell;
                                       //   'eks-cluster' => honeycomb; 'lambda-fn' => grid; ...
  changedAt: number;                   // epoch ms of last state change (sort + hysteresis)
  children?: Cell[];                   // inline for small trees
  childrenRef?: string;                // or a handle to fetch children lazily (big trees)
}
```

A pod is `Cell{ level:'pod', kind:'pod', renderKey: undefined }`. A continent is
`Cell{ level:'provider', kind:'aws' }`. **Same type, different `renderKey`.** The leaf k8s
machine keeps the name `node` *only here*, inside the EKS subtree.

## 4. One recursive rollup (everywhere)

A single function, applied bottom-up at every level:

```ts
function rollup(children: Cell[]): Rollup {
  const severity = worstWeighted(children.map(c => c.rollup.severity));
  const total    = sum(children, c => c.rollup.total);
  const affected = sum(children, c => c.rollup.affected);
  const bySeverity = mergeCounts(children.map(c => c.rollup.bySeverity));
  const affectedFraction = total ? affected / total : 0;
  const intensity = intensityFrom(affected, affectedFraction);   // §5
  return { severity, total, affected, affectedFraction, intensity, bySeverity };
}
```

**Leaf cells** are the base case: a pod's rollup is
`{ severity: pod.state, total: 1, affected: state∈{warn,crit} ? 1 : 0, bySeverity: {[state]:1}, … }`.

**The quartile (4 hexes) is a *presentation* of a node-cell's child rollup**, not a separate
calculation — `litHexes` etc. (`FUNCTIONAL_SPEC §4`) are derived from the same affected/total.
**The pulsating circle is the *presentation* of any cell's rollup.** Same numbers, two
encodings, chosen by `renderKey`/level. This is what makes the map seamless across levels.

`worstWeighted`: at minimum, `crit > warn > ok > gone` (worst wins). Optionally weight by
affected magnitude so a provider with one tiny crit doesn't look identical to one in meltdown;
keep the rule in `config.ts`.

## 5. Pulsation / intensity encoding (high-level map cells)

A non-leaf cell renders as a circle:
- **hue** = `rollup.severity` (green ok · amber warn · red crit · gray gone) — the color of the
  worst thing inside.
- **intensity** (0..1) drives **darkness/saturation + pulse speed + glow radius**:
  ```ts
  intensity = clamp(W_FRACTION * affectedFraction
                  + W_MAGNITUDE * norm(log10(affected + 1)), 0, 1);
  ```
  A handful affected → faint, slow pulse; tens of thousands → deep, fast throb. Absolute
  magnitude matters (10k affected pods under a provider must look scarier than 1), which is why
  `log10(affected)` is in the mix alongside the fraction. Weights live in `config.ts`.
- **size** = footprint (`rollup.total`, log-scaled) — independent of severity, so large
  estates read large at rest.

Zooming into a circle decomposes it into its child circles (same encoding), and eventually, at
the EKS `resource` leaf, the representation switches to the honeycomb wall. Healthy children
fold exactly as in `FUNCTIONAL_SPEC §5` (with hysteresis) at every level — a healthy continent
collapses to a count too.

## 6. Global id scheme

Stable, globally unique, path-like, hierarchy-encoding, easy to route on:

```
estate
aws
aws/123456789012
aws/123456789012/eks
aws/123456789012/eks/prod-eks-use1
aws/123456789012/eks/prod-eks-use1/node/ip-10-0-4-91
aws/123456789012/eks/prod-eks-use1/node/ip-10-0-4-91/pod/payments/payments-api-7f9c…
```

The web app routes on `/cell/:id*`; the renderer is chosen by the resolved cell's `renderKey`
(or `level`). One routing scheme for the entire map.

## 7. Adapter architecture (how new services/clouds plug in)

The map shell, zoom, Cell model, and rollup are **generic and frozen**. Each service type is a
plugin:

```ts
export interface ResourceAdapter {
  serviceKind: string;                       // 'eks' | 'gke' | 'lambda' | 'rds' | ...
  renderKey: string;                         // 'eks-cluster' | 'lambda-fn' | ...
  discover(account: { provider: string; accountId: string }): Promise<Cell[]>; // level:'resource'
  resourceTree(resourceId: string): Promise<Cell>;   // root resource Cell with its subtree
}
```

- The **EKS adapter** wraps the `ClusterProvider` from `ARCHITECTURE §6`; its `resourceTree`
  builds `resource(cluster) → node → pod` Cells and sets `renderKey:'eks-cluster'`.
- **GKE adapter** reuses almost all of the k8s leaf (k8s is k8s) — different discovery/auth.
- **Lambda adapter** has its own leaf renderer (`renderKey:'lambda-fn'`, a functions grid keyed
  on error rate / throttles / duration); its leaf "units" are functions, not pods — but its
  `Rollup` is identical in shape, so it rolls up into the map with zero shell changes.

Each `renderKey` maps to a leaf renderer component in the web app. Adding a service = an adapter
+ a leaf renderer. **Nothing in the map/zoom/rollup changes.** That is the no-rework guarantee.

## 8. Read-only still holds at every level

The read-only guarantee (`FUNCTIONAL_SPEC §9`) is a property of the whole platform: no adapter
exposes a write path, and there is no mutating route or UI control at any level — provider,
account, service, resource, or pod.

## 9. Concrete changes to the in-progress POC (do these now; each is small)

1. **Rename** the generic tree unit to `Cell`; keep `Node` for the k8s worker only.
2. **Re-root the EKS data as a subtree:** assign global path ids (§6) and parent the
   cluster under stub `provider`/`account`/`service`/`resource` cells (single-valued is fine
   for the POC). The wall renders the `resource`(cluster) cell's subtree.
3. **Generalize the rollup:** implement the recursive `rollup()` (§4); make the quartile
   (`litHexes`, …) a *derivation* of a node-cell's child rollup, not a standalone function.
   The existing `FUNCTIONAL_SPEC §4` math is unchanged — it just consumes the generic rollup.
4. **Wrap the provider as a `ResourceAdapter`** (`serviceKind:'eks'`, `renderKey:'eks-cluster'`).
5. **Route the web app on `/cell/:id`** and select the renderer by `renderKey`
   (`'eks-cluster'` → the honeycomb). The cluster→node→pod zoom becomes a sub-zoom within the
   EKS leaf renderer.
6. **Rename for the platform:** keep "Hexwall" as the EKS leaf view; name the platform
   (suggested: **Tessera**). Update repo/package names accordingly.

None of these block the current POC acceptance gate (`TEST_PLAN.md §5`); they make it the first
slice of the full map instead of a dead-end. Add tests: a `rollup()` unit test at ≥2 levels
(pod→node→…→provider) proving counts aggregate, and a routing test that `/cell/<cluster-id>`
renders the honeycomb.

## 10. Future leaf renderers (catalogue, not a build requirement)

| serviceKind | renderKey | leaf "unit" | health signals |
|---|---|---|---|
| eks / gke / aks | `eks-cluster` | pod (per node) | pod state, node pressure (done) |
| lambda / cloud-run / functions | `lambda-fn` | function | error rate, throttles, duration, cold starts |
| rds / cloud-sql | `db-instance` | instance/replica | connections, replication lag, CPU, storage |
| ec2 / vm | `vm-fleet` | instance | status checks, CPU, disk, reachability |
| sqs / pubsub | `queue` | queue | depth, age of oldest msg, DLQ |

All of these produce the same `Rollup`, so they share the map, the zoom, and the pulsation
encoding. Only their leaf renderer differs.
