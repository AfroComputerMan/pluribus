# Provisioning is a constrained author-loop, not an autonomous agent

**Status:** accepted (2026-05-29)

## Context & Decision

When a repo has no usable container config and deterministic stack detection fails, Pluribus generates a **Repo image** via an LLM. Provisioning is the one step that must act *outside* a sandbox (it is *building* the sandbox), so making it an autonomous tool-using agent would require giving an un-sandboxed agent the host Docker socket — directly defeating [ADR 0002](0002-sandbox-as-safety-boundary.md).

We instead use a **constrained author-loop**: the model only emits **Dockerfile text** (and may request read-only repo peeks); the **Rust backend (bollard) executes** every build. The model never receives a host shell or the Docker socket.

## The loop

Resolution order (the hybrid from earlier): reuse existing repo config → deterministic stack detection → this model-author loop.

```
loop (max N attempts):
  model → Dockerfile text (Base layer only)
  Rust: docker build (base) → overlay Agent layer (FROM base; install Node+Pi)
        → start pi --rpc, ping it
        → run detected install/build (npm ci | pip install | go build | make)
  any failure → feed error back to model for next revision
  all pass → user approves → store app-side
fail ×N → escalate to user with best-effort Dockerfile + last error (editable)
```

## Why these choices

- **Model authors only the Base layer**; Pluribus templates the **Agent layer** overlay. The smoke test validates the *composed* image, so a base that can't run Pi (e.g. wrong libc) fails and feeds back to the model.
- **Done bar = build + Pi-ping + detected install/build succeeds.** The repo's test suite is excluded: tests are slow, need fixtures/services, and flake — a flaky test would stall the loop on issues unrelated to the Dockerfile.
- **Bounded + escalation**: the loop can't run forever; on exhaustion the user gets an editable best-effort Dockerfile rather than an infinite spend.

## Consequences

- Less capable than a full agent on truly bizarre repos — mitigated by the user-edit escalation.
- Read-only repo peeks the model can request must themselves be constrained (no arbitrary file/host access).
