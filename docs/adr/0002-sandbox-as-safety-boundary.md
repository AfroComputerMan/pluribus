# The sandbox is the safety boundary; no per-tool approval

**Status:** accepted (2026-05-29)

## Context & Decision

Pluribus runs each agent (a Pi process) inside a per-agent Docker **Sandbox**, operating on a throwaway per-agent **Clone**. Pi's RPC protocol provides **no per-tool approval round-trip** — tools execute autonomously and `tool_execution_*` events are informational only. We **accept autonomous tool execution** and rely on the sandbox + clone as the safety boundary, rather than gating individual tool calls.

## Why

- The reason tools like Claude Code prompt for approval is that they act on the user's real machine. A Pluribus agent is confined to a container and can only modify its own disposable clone — so the blast radius is already contained.
- Building per-tool approval would require disabling Pi's native tools and re-implementing them as custom tools that call `extension_ui_request('confirm')` before executing — the exact tool-rewrite cost we avoided by running Pi natively in-container.
- It aligns with Pi's explicit design (no permission popups).

## Control model instead of approval

Observe live (`message_update`, `tool_execution_*`) + `steer` (mid-run guidance) + `abort` + `set_model` + **post-hoc review of the clone's branch diff** before merging.

## Consequences

- Anything that leaves the box (git push, outbound network, host secrets) is *not* contained by this decision and must be controlled separately (network policy, secret scoping, or a future gated escape-tool). Revisit if/when agents are given push or network access.
