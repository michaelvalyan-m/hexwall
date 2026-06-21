#!/usr/bin/env sh
# Tessera / Hexwall — one-stop deploy helper for Model A (read-only, in-cluster).
# No make/helm/kustomize needed — just docker, kubectl, and (for ECR) aws.
#
#   ./deploy/tessera.sh build                 # build the image
#   REGISTRY=<acct>.dkr.ecr.<region>.amazonaws.com ./deploy/tessera.sh ecr-login ecr-repo push
#   REGISTRY=... CLUSTER=my-eks ./deploy/tessera.sh deploy check-rbac
#   ./deploy/tessera.sh port-forward          # then open http://localhost:8080
#
# Config via env vars (all optional except REGISTRY for push/deploy):
#   REGISTRY    container registry host/repo prefix (e.g. 111122223333.dkr.ecr.us-east-1.amazonaws.com)
#   IMAGE_NAME  image name                 (default: tessera)
#   TAG         image tag                  (default: short git sha, else 'latest')
#   IMAGE       full image ref            (default: $REGISTRY/$IMAGE_NAME:$TAG)
#   REGION      AWS region for ECR         (default: $AWS_REGION or us-east-1)
#   CLUSTER     display name for this cluster (default: leaves the manifest's value)
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
K8S="$SCRIPT_DIR/k8s"
NS=tessera

IMAGE_NAME=${IMAGE_NAME:-tessera}
TAG=${TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}
REGION=${REGION:-${AWS_REGION:-us-east-1}}
if [ -n "${REGISTRY:-}" ]; then
  IMAGE=${IMAGE:-$REGISTRY/$IMAGE_NAME:$TAG}
else
  IMAGE=${IMAGE:-$IMAGE_NAME:$TAG}
fi

say() { printf '\033[36m[tessera]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[tessera] error:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"; }

cmd_build() {
  need docker
  say "building $IMAGE"
  docker build -f "$SCRIPT_DIR/Dockerfile" -t "$IMAGE" "$ROOT"
}

cmd_ecr_login() {
  need aws; need docker
  [ -n "${REGISTRY:-}" ] || die "set REGISTRY=<acct>.dkr.ecr.<region>.amazonaws.com"
  say "logging in to $REGISTRY ($REGION)"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
}

cmd_ecr_repo() {
  need aws
  say "ensuring ECR repo $IMAGE_NAME exists"
  aws ecr describe-repositories --repository-names "$IMAGE_NAME" --region "$REGION" >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name "$IMAGE_NAME" --region "$REGION" \
         --image-scanning-configuration scanOnPush=true >/dev/null
}

cmd_push() {
  need docker
  say "pushing $IMAGE"
  docker push "$IMAGE"
}

cmd_deploy() {
  need kubectl
  say "deploying to namespace '$NS' (image: $IMAGE)"
  kubectl apply -f "$K8S/namespace.yaml"
  kubectl apply -f "$K8S/serviceaccount.yaml"
  kubectl apply -f "$K8S/rbac.yaml"
  kubectl apply -f "$K8S/service.yaml"
  kubectl apply -f "$K8S/networkpolicy.yaml"
  # fill the image into the Deployment, then apply
  sed "s|__IMAGE__|$IMAGE|g" "$K8S/deployment.yaml" | kubectl apply -f -
  # set the display label via the API (not sed) so labels with &, |, etc. can't corrupt the manifest
  if [ -n "${CLUSTER:-}" ]; then
    kubectl -n "$NS" set env deploy/tessera "TESSERA_CLUSTER=$CLUSTER"
  fi
  kubectl -n "$NS" rollout status deploy/tessera --timeout=120s
}

# Prove the read-only contract from the cluster's own authorization layer.
cmd_check_rbac() {
  need kubectl
  sa="system:serviceaccount:$NS:tessera"
  say "verifying read-only RBAC for $sa"
  ok=0
  expect() { # expect <yes|no> <verb> <resource>
    got=$(kubectl auth can-i "$2" "$3" --as="$sa" 2>/dev/null || echo no)
    if [ "$got" = "$1" ]; then printf '  \033[32mok\033[0m   can-i %-7s %-12s = %s\n' "$2" "$3" "$got";
    else printf '  \033[31mFAIL\033[0m can-i %-7s %-12s = %s (expected %s)\n' "$2" "$3" "$got" "$1"; ok=1; fi
  }
  expect yes get    pods
  expect yes list   nodes
  expect yes watch  pods
  expect yes get    pods/log
  expect no  create pods
  expect no  delete pods
  expect no  patch  nodes
  expect no  delete nodes
  expect no  create deployments
  # least-privilege regression guard: a read-only monitor must NOT be able to read Secrets
  expect no  get    secrets
  expect no  list   secrets
  expect no  '*'    '*'
  [ "$ok" = 0 ] && say "read-only verified ✓" || die "RBAC is broader than read-only — see FAILs above"
}

cmd_port_forward() {
  need kubectl
  say "forwarding http://localhost:8080  ->  svc/tessera (ctrl-c to stop)"
  kubectl -n "$NS" port-forward svc/tessera 8080:80
}

cmd_logs()   { need kubectl; kubectl -n "$NS" logs -l app.kubernetes.io/name=tessera -f --tail=100; }
cmd_status() { need kubectl; kubectl -n "$NS" get deploy,pod,svc,sa -l app.kubernetes.io/name=tessera; }
cmd_undeploy() {
  need kubectl
  say "removing namespace '$NS' and cluster RBAC"
  kubectl delete -f "$K8S/rbac.yaml" --ignore-not-found
  kubectl delete namespace "$NS" --ignore-not-found
}

usage() {
  cat <<EOF
Tessera deploy helper (Model A — read-only, in-cluster)

usage: ./deploy/tessera.sh <command> [<command> ...]

  build         docker build the image
  ecr-login     docker login to ECR (needs REGISTRY, aws)
  ecr-repo      create the ECR repo if missing (needs aws)
  push          docker push the image
  deploy        kubectl apply the manifests (read-only RBAC, hardened pod)
  check-rbac    prove the ServiceAccount can only read (kubectl auth can-i)
  port-forward  forward localhost:8080 -> the UI
  logs          tail the pod logs
  status        show the deployed objects
  undeploy      delete the namespace + cluster RBAC

image: $IMAGE
EOF
}

[ $# -gt 0 ] || { usage; exit 0; }
for c in "$@"; do
  case "$c" in
    build)        cmd_build ;;
    ecr-login)    cmd_ecr_login ;;
    ecr-repo)     cmd_ecr_repo ;;
    push)         cmd_push ;;
    deploy)       cmd_deploy ;;
    check-rbac)   cmd_check_rbac ;;
    port-forward) cmd_port_forward ;;
    logs)         cmd_logs ;;
    status)       cmd_status ;;
    undeploy)     cmd_undeploy ;;
    -h|--help|help) usage ;;
    *) die "unknown command: $c (try --help)" ;;
  esac
done
