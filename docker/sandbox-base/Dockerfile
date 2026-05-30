# syntax=docker/dockerfile:1

# --- Stage `pi-base`: the constant — Node solely as Pi's runtime + Pi pinned. ---
# Recommend pinning to a Node digest for full reproducibility:
#   FROM node@sha256:<digest> AS pi-base
# Use `docker pull node:22-bookworm-slim` and check `docker inspect node:22-bookworm-slim`
# to retrieve the current digest, then substitute above.
FROM node:22-bookworm-slim AS pi-base
RUN npm install -g @mariozechner/pi-coding-agent@0.73.1
# no-op host process; Pi is launched per-session via `docker exec`
ENTRYPOINT ["sleep", "infinity"]

# --- Composable toolchain layers (opt-in via --target). #18 builds `pi-base` only. ---
# The language toolchains here are for the agent's *workspace*, not Pi's own runtime.
# Build a toolchain overlay with: docker build --target with-python -t pluribus-pi-sandbox:python docker/sandbox-base

FROM pi-base AS with-python
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

FROM pi-base AS with-go
RUN apt-get update \
    && apt-get install -y --no-install-recommends golang \
    && rm -rf /var/lib/apt/lists/*

# Future composable stages: with-rust, with-node-dev, etc.
# Compose what a given project repo requires by picking the right --target.
