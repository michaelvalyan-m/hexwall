# Tessera / Hexwall — Model A image: a single read-only container that reads the EKS cluster it
# runs in (via the pod ServiceAccount) and serves the web UI + API. Multi-stage, distroless,
# non-root. Build context is the repo root:  docker build -f deploy/Dockerfile -t <img> .

# Base images are pinned by digest for reproducible, tamper-evident builds. To bump, run
#   docker buildx imagetools inspect <tag>   and update the digest + the dated comment.
# Pinned 2026-06-20.

# ---- deps: production-only node_modules (esbuild externalizes runtime deps, so we ship them) ----
FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --omit=dev --ignore-scripts

# ---- build: full install, then bundle the server + build the web ----
FROM node:22-bookworm-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2 AS build
WORKDIR /app
# Don't pull Playwright browsers during the image build (only needed for e2e, not for bundling).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# NOTE: no --ignore-scripts here — esbuild's install step must run to place its native binary.
RUN npm ci
COPY . .
RUN npm run build
# server.mjs (bundled TS + @tessera/shared) lands in packages/server/dist;
# the web bundle lands in packages/web/dist (served by the server at TESSERA_SERVE_WEB=1).

# ---- runtime: distroless node, nonroot uid 65532, no shell, no package manager ----
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TESSERA_PROVIDER=kube \
    TESSERA_SERVE_WEB=1 \
    PORT=8080
# production node_modules (fastify, @fastify/static, @kubernetes/client-node, zod, + transitive)
COPY --from=deps  /app/node_modules           ./node_modules
# bundled server + prebuilt web — relative layout preserved (server resolves ../../web/dist)
COPY --from=build /app/packages/server/dist    ./packages/server/dist
COPY --from=build /app/packages/web/dist        ./packages/web/dist
EXPOSE 8080
# distroless nodejs ENTRYPOINT is `node`; pass the bundled server as the arg.
CMD ["packages/server/dist/server.mjs"]
