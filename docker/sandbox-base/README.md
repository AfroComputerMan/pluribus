# Pluribus Pi Sandbox — Base Image

This directory contains the `Dockerfile` for the sandbox image that runs
`pi --mode rpc` inside a per-agent Docker container (see ADR 0002, issue #18).

## Image design

The image is split into a **constant Pi base** (`pi-base`) and optional,
per-project **toolchain overlay** stages:

| Stage | Tag | Contents |
|---|---|---|
| `pi-base` | `pluribus-pi-sandbox:base` | Node 22 (Pi's runtime) + Pi 0.73.1 |
| `with-python` | `pluribus-pi-sandbox:python` | `pi-base` + Python 3 + pip |
| `with-go` | `pluribus-pi-sandbox:go` | `pi-base` + Go |

Node is present **only** because `@mariozechner/pi-coding-agent` is an npm
package — it is Pi's own runtime, not a requirement of the JSONL/stdio piping.
The toolchain layers address what Pi's *agent workspace* needs (the language the
target repo is written in), and are entirely composable.

## Build the base image (required for #18 POC)

```sh
docker build --target pi-base -t pluribus-pi-sandbox:base docker/sandbox-base
```

Confirm the pinned version:

```sh
docker run --rm pluribus-pi-sandbox:base pi --version
# expect: 0.73.1
```

## Build a toolchain overlay

```sh
# Python overlay
docker build --target with-python -t pluribus-pi-sandbox:python docker/sandbox-base

# Go overlay
docker build --target with-go -t pluribus-pi-sandbox:go docker/sandbox-base
```

## Node digest pinning (recommended for production)

For full reproducibility, replace the `FROM node:22-bookworm-slim` line in the
`Dockerfile` with a digest pin:

```dockerfile
FROM node@sha256:<digest> AS pi-base
```

Retrieve the current digest:

```sh
docker pull node:22-bookworm-slim
docker inspect node:22-bookworm-slim --format '{{index .RepoDigests 0}}'
```

## Notes

- The `ENTRYPOINT ["sleep", "infinity"]` is a no-op host process. Pi itself is
  launched **per session** via `docker exec` by the Tauri backend (bollard).
- The API key is passed via the exec `env` at runtime — it is **never baked
  into the image**.
- A future image pipeline (issue #19 / ADR 0004) will automate selecting the
  right `--target` per repository. For the #18 POC, build `pi-base` manually.
