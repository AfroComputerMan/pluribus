# The sandbox is the safety boundary; no per-tool approval

**Status:** accepted (2026-05-29)

## Context & Decision

Pluribus runs each agent (a Pi process) inside a per-agent Docker **Sandbox**, operating on a throwaway per-agent **Clone**. Pi's RPC protocol provides **no per-tool approval round-trip** — tools execute autonomously and `tool_execution_*` events are informational only. We **accept autonomous tool execution** and rely on the sandbox + clone as the safety boundary, rather than gating individual tool calls.

## Why

- The reason tools like Claude Code prompt for approval is that they act on the user's real machine. A Pluribus agent is confined to a container and can only modify its own disposable clone — so the blast radius is already contained.
- Building per-tool approval would require disabling Pi's native tools and re-implementing them as custom tools that call `extension_ui_request('confirm')` before executing — the exact tool-rewrite cost we avoided by running Pi natively in-container.
- It aligns with Pi's explicit design (no permission popups).

## Control model instead of approval

Observe live (`message_update`, `tool_execution_*`, `queue_update`) + `steer` (mid-run guidance, **queued and applied at the next turn/tool boundary** — not a mid-token interrupt) + `abort` (halts promptly) + `set_model` + **post-hoc review of the clone's branch diff** before merging. See [ADR 0005](0005-pi-rpc-protocol.md) for the verified event/command shapes.

## Consequences

- Anything that leaves the box (git push, outbound network, host secrets) is *not* contained by this decision and must be controlled separately (network policy, secret scoping, or a future gated escape-tool). Revisit if/when agents are given push or network access.
- **Native tools run without approval, but `extension_ui_request` is a real round-trip.** A **Skill or Extension** (not a native tool) can call `extension_ui_request` (`confirm`/`select`/`input`/…). This does *not* reintroduce per-tool approval for native tools, but the Rust bridge **must respond** with `extension_ui_response` or the agent blocks indefinitely. Minimum: auto-cancel; better: surface the request in the UI.
- **The boundary only exists once the agent is sandboxed.** During the host-only POC stage (issue #17, no container yet) Pi's native `write`/`edit`/`bash` tools execute on the **host** — empirically confirmed (a run wrote a 21 KB file to the host unprompted). Do not point a host-stage agent at any real working tree; this is the concrete argument for prioritizing the container (issue #18).
