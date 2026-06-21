# Deploying Tessera / Hexwall to EKS — Model A (read-only, in-cluster)

This packages the POC as **one read-only container** that runs inside the EKS cluster it
monitors. It reads nodes/pods/events/logs through the pod's ServiceAccount and serves the web
UI + API. There is **no write path** to the cluster and **no public exposure** by default.

```
┌─ your EKS cluster ─────────────────────────┐
│  ns: tessera                               │
│   ServiceAccount  tessera  ──┐             │
│   ClusterRole (get/list/watch nodes,pods,  │
│     events; get pods/log)  ──┘ read-only   │
│   Deployment  tessera  (distroless,nonroot)│
│     └─ reads this cluster, serves :8080    │
│   Service (ClusterIP, no external IP)      │
└────────────────────────────────────────────┘
      reach the UI with `kubectl port-forward`
```

## Prerequisites
- An EKS cluster and a `kubectl` context pointing at it (`aws eks update-kubeconfig --name <cluster>`).
- `docker` (to build) and a registry the cluster can pull from — **ECR** is assumed below.
- `aws` CLI (only for the ECR steps).
- Permission to create a Namespace, ServiceAccount, ClusterRole/Binding, Deployment, Service.

## One-time: build & push the image
```sh
export REGISTRY=111122223333.dkr.ecr.us-east-1.amazonaws.com   # your account/region
export REGION=us-east-1

./deploy/tessera.sh build ecr-login ecr-repo push
```
`TAG` defaults to the short git SHA; override with `TAG=v0.1.0` if you like.

## Deploy
```sh
# CLUSTER is just the display label shown in the UI for this cluster.
REGISTRY=$REGISTRY CLUSTER=prod-eks ./deploy/tessera.sh deploy check-rbac
```
`deploy` applies the manifests and waits for rollout. `check-rbac` then **proves** the
ServiceAccount can only read — it asserts `can-i get pods = yes` and `can-i create/delete/patch …
= no` straight from the cluster's authorization layer.

## See it
```sh
./deploy/tessera.sh port-forward     # then open http://localhost:8080
./deploy/tessera.sh logs             # tail logs
./deploy/tessera.sh status           # show the objects
```

## Remove it
```sh
./deploy/tessera.sh undeploy         # deletes the namespace + cluster RBAC
```

## Why this is safe (the "no security risk" checklist)
- **Read-only RBAC** — the ClusterRole grants only `get/list/watch` on `nodes`/`pods`/`events`
  and `get` on `pods/log`. No `create/update/patch/delete` on anything. This matches the verbs
  the code actually issues, and is enforced twice over: the provider interface has no write
  method (unit-tested) and the cluster RBAC physically can't write. `check-rbac` verifies it —
  including that it can **not** read `secrets`.
- **No public surface** — `Service` is `ClusterIP`; nothing is exposed outside the cluster.
  Access is via `kubectl port-forward` only. (To expose later: change the Service type / add an
  Ingress — opt-in, not default. See the caveat below before you do.)
- **Default-deny ingress NetworkPolicy** — even in-cluster, no other pod can reach the API over
  the ClusterIP; egress to the API server + DNS stays open. (No-op on clusters without a policy
  engine; `kubectl port-forward` and kubelet probes are unaffected.)
- **Hardened pod (PSS `restricted`)** — distroless image, `runAsNonRoot` (uid 65532),
  `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, all Linux capabilities dropped,
  `seccompProfile: RuntimeDefault`. The namespace enforces the `restricted` Pod Security Standard.
- **Minimal, pinned image** — `gcr.io/distroless/nodejs22-debian12:nonroot`: no shell, no package
  manager, tiny CVE surface. All base images are **digest-pinned** in the Dockerfile for
  reproducible, tamper-evident builds (to bump: `docker buildx imagetools inspect <tag>`, then
  update the digest + the dated comment). ECR scan-on-push is enabled by `ecr-repo`.
- **Resource-bounded** — CPU/memory requests+limits so it can't starve the cluster.

> **Sensitive-data caveat — read-only is not low-sensitivity.** This grant lets the app, and
> therefore anyone who can reach its UI, read pod **logs** and full pod **specs (including
> container env vars, which often hold tokens/passwords)** across **all** namespaces, including
> `kube-system`. The UI has **no authentication** — access is gated solely by who can
> `kubectl port-forward` to the Service. Treat UI reachability as equivalent to cluster-wide log +
> pod-env read access, and **do not** expose the Service via LoadBalancer/Ingress without putting
> authentication in front of it.

## Resource metrics
Node **CPU and memory** usage % come from **metrics-server** (`metrics.k8s.io`, read-only). If
metrics-server isn't installed, the app degrades gracefully to `0%` and still works off node
conditions + pod states. **Disk %** stays `0` — metrics-server exposes no disk metric; node disk
health is driven by the `DiskPressure` condition instead. Everything else (honeycomb, node health,
pod detail, crash blocks, events, live log tail) works against the real cluster.

## Configuration reference (Deployment env)
| Var | Value | Meaning |
|-----|-------|---------|
| `TESSERA_PROVIDER` | `kube` | use the real cluster reader (not the mock) |
| `TESSERA_SERVE_WEB` | `1` | serve the web UI from the same container/origin |
| `TESSERA_CLUSTER` | `prod-eks` | display label for this cluster (set via `CLUSTER=`) |
| `PORT` | `8080` | listen port |

`TESSERA_TEST_HOOKS` and `TESSERA_DEV_TIMELINE` are **never** set in this image.
