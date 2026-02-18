# Competitive Analysis: Pluribus vs. Conductor, Codex App, OpenCode, Kilo Code

**Date:** 2026-02-18
**Depth:** Deep
**Confidence:** High (primary sources from official docs + web research)

---

## Executive Summary

Pluribus is a Tauri 2 + React 19 desktop app wrapping Claude CLI with a chat interface. Four competitors were analyzed: **Conductor** (workspace orchestrator), **OpenAI Codex App** (desktop coding agent), **OpenCode** (open-source terminal TUI), and **Kilo Code** (VS Code extension). The analysis reveals Pluribus has a solid foundation (streaming chat, session management, workspace organization, themes, dev tools) but is missing critical features that competitors treat as table stakes: **git integration**, **diff viewing**, **worktree isolation**, **parallel agents**, **integrated terminal**, **file management**, and **extensibility systems** (skills, MCP, custom modes).

---

## Product Profiles

### Conductor (conductor.build)
- **Type:** macOS desktop app (workspace orchestrator)
- **Built by:** Melty Labs (v0.35.3)
- **Core idea:** Run a team of parallel coding agents (Claude Code + Codex) in isolated git worktrees
- **AI backend:** Claude Code, OpenAI Codex, plus OpenRouter/Bedrock/Vertex/Vercel providers

### OpenAI Codex App (developers.openai.com/codex/app)
- **Type:** macOS desktop app (coding agent)
- **Built by:** OpenAI
- **Core idea:** Focused desktop experience for running Codex threads in parallel with built-in git, worktrees, skills, and automations
- **AI backend:** GPT-5.3-Codex, GPT-5.2-Codex, GPT-5.3-Codex-Spark (real-time)

### OpenCode (opencode.ai)
- **Type:** Cross-platform terminal TUI (Go binary)
- **Built by:** Community (100K+ GitHub stars, 700+ contributors)
- **Core idea:** Open-source AI coding agent in the terminal with broad model support
- **AI backend:** 75+ providers via Models.dev, including local models

### Kilo Code (kilo.ai)
- **Type:** VS Code + JetBrains extension + CLI
- **Built by:** Kilo-Org (forked from Roo Code/Cline lineage)
- **Core idea:** All-in-one agentic engineering platform with modes, MCP marketplace, cross-device sync
- **AI backend:** 500+ models across 60+ providers, including local models

---

## Feature Comparison Matrix

### Legend
- **Y** = Fully implemented
- **P** = Partial/scaffolded
- **N** = Not present
- **C** = Via Claude CLI (inherited, not app-native)

| Feature | Pluribus | Conductor | Codex App | OpenCode | Kilo Code |
|---------|----------|-----------|-----------|----------|-----------|
| **CHAT & CONVERSATION** | | | | | |
| Real-time message streaming | Y | Y | Y | Y | Y |
| Message history persistence | Y (SQLite) | Y | Y | Y | Y |
| Thread/conversation management | Y | Y (workspaces) | Y (threads) | Y | Y (tasks) |
| Thread forking (/fork) | N | N | Y | N | N |
| Conversation compaction | N | N | Y (/compact) | N | N |
| Voice input | N | N | Y (Ctrl+M) | N | Y |
| Image/attachment input | P (scaffolded) | N | Y (drag-drop) | N | Y |
| File mentions (@) | N | N | Y (fuzzy search) | N | N |
| Markdown rendering | Y (GFM) | Y | Y | Y | Y |
| Tool use visualization | Y (rich) | Y | Y | Y | Y |
| Reasoning/thinking blocks | Y | N | N | N | N |
| | | | | | |
| **GIT INTEGRATION** | | | | | |
| Git branch tracking | P (stored, unused) | Y | Y | Y | Y |
| Changes/diff panel | N | Y | Y (rich) | N | N |
| Inline diff comments | N | N | Y | N | N |
| Chunk-level staging/revert | N | N | Y | N | N |
| Commit from app | N | Y | Y | C | C |
| Push to remote | N | Y | Y | C | C |
| Create PR from app | N | Y | Y | C | C |
| Branch creation | N | Y (auto) | Y | C | C |
| | | | | | |
| **WORKSPACE ISOLATION** | | | | | |
| Git worktree support | N | Y (core) | Y (core) | N | Y |
| Parallel agents in isolation | N | Y (core) | Y | Y | Y (planned) |
| Worktree setup scripts | N | Y | Y | N | N |
| Per-workspace terminal | N | Y | Y | N/A | N/A |
| | | | | | |
| **TERMINAL** | | | | | |
| Integrated terminal | N | Y | Y (Cmd+J) | N/A (is TUI) | Y (VS Code) |
| Per-thread terminal | N | Y | Y | N/A | N |
| Shell command execution | C | Y | Y | Y | Y |
| Process management | N | Y | N | N | N |
| | | | | | |
| **FILE MANAGEMENT** | | | | | |
| File tree/explorer | N | Y | N | Y | Y |
| Directory picker | Y (Tauri dialog) | Y | Y | N/A | N/A |
| File search | N | N | Y (@mention) | Y | Y |
| | | | | | |
| **AI / LLM FEATURES** | | | | | |
| Multi-model support | N (Claude only) | Y (Claude + Codex) | Y (GPT-5.x family) | Y (75+ providers) | Y (500+ models) |
| Model switching mid-session | N | N | Y (/model) | Y | Y |
| BYO API key | N | Y | Y | Y | Y |
| Local model support | N | N | N | Y (Ollama) | Y (Ollama, LM Studio) |
| MCP integration (app-native) | N | Y | Y | Y | Y (marketplace) |
| Skills/custom capabilities | N | Y (scripts) | Y (full system) | N | Y |
| Custom modes | N | N | Y (plan/agent/read-only) | N | Y (Ask/Architect/Code/Debug/Orchestrator/custom) |
| Agent personality selection | N | N | Y (terse vs conversational) | N | N |
| Web search | C | N | Y (first-party) | N | N |
| | | | | | |
| **AUTOMATION** | | | | | |
| Scheduled automations | N | N | Y (core) | N | N |
| Background agent execution | N | Y | Y | N | Y (cloud agents) |
| CI/CD integration | N | N | Y (GitHub Action) | N | N |
| SDK/API for programmatic use | N | N | Y (Codex SDK) | N | N |
| Cloud execution | N | N | Y (Codex Cloud) | N | Y (cloud agents) |
| | | | | | |
| **UI / UX** | | | | | |
| Desktop app | Y (Tauri) | Y (macOS) | Y (macOS) | N (terminal) | N (extension) |
| Theme system | Y (5 themes) | N | Y (light/dark) | N | N |
| Multiple layouts | P (locked to Atelier) | N | N | N | N |
| Command palette | N | N | Y (Cmd+K) | N | N |
| Pop-out/floating windows | N | N | Y | N | N |
| Sleep prevention | N | N | Y | N | N |
| Keyboard shortcuts | P | Y | Y | Y | Y |
| Scratchpad/notes | P (scaffolded) | N | N | N | N |
| | | | | | |
| **DEV TOOLS** | | | | | |
| Stream analytics panel | Y (rich) | N | N | N | N |
| Token/cost tracking | Y (dev panel) | N | N | N | Y |
| Session registry viewer | Y | N | N | N | N |
| MCP server status display | Y | N | N | N | N |
| Context pressure visualization | Y | N | N | N | N |
| | | | | | |
| **COLLABORATION** | | | | | |
| Team features | N | N | Y (shared skills) | N | Y (team billing, shared modes) |
| Session sharing | N | N | N | Y (share links) | Y (cross-device sync) |
| | | | | | |
| **EXTENSIBILITY** | | | | | |
| Plugin/extension system | N | Y (scripts, MCP) | Y (skills, MCP, SDK) | Y (MCP, custom tools) | Y (MCP marketplace, custom modes) |
| Slash commands | N | Y | Y (rich set) | N | N |
| Configuration file | N | N | Y (config.toml) | Y (opencode.json) | Y (.clinerules) |
| | | | | | |
| **PLATFORM** | | | | | |
| macOS | Y | Y | Y | Y | Y |
| Windows | Y | N | Alpha | Y | Y |
| Linux | Y | N | Planned | Y | Y |

---

## Gap Analysis: What Pluribus Is Missing

### Tier 1 -- Critical Gaps (every competitor has these)

1. **Git Integration (Diff View, Staging, Commit/Push/PR)**
   - Every competitor surfaces git operations natively. Conductor and Codex App have rich diff panels with per-chunk staging. Pluribus stores git branch in the DB but doesn't use it.
   - **Impact:** Users must context-switch to a terminal or editor to review/commit AI-generated changes.

2. **Workspace/Worktree Isolation**
   - Conductor and Codex App both use git worktrees so parallel agents don't conflict. Kilo Code supports worktrees. Pluribus has no isolation model.
   - **Impact:** Users can't safely run parallel AI tasks on the same repo.

3. **Integrated Terminal**
   - Codex App has per-thread terminals (Cmd+J). Conductor has per-workspace terminals. OpenCode IS a terminal. Pluribus has none.
   - **Impact:** Users can't validate AI changes, run tests, or execute commands without leaving the app.

4. **MCP Integration (App-Native)**
   - All four competitors support MCP configuration at the app level. Pluribus only inherits MCP through Claude CLI subprocess, with no app-level configuration or visibility.
   - **Impact:** No extensibility story for connecting to external tools (Figma, Linear, documentation, etc.).

### Tier 2 -- Major Gaps (most competitors have these)

5. **Multi-Agent Parallelism**
   - Conductor (core feature), Codex App (threads), OpenCode (multiple sessions), and Kilo Code (parallel agents) all support running multiple AI agents simultaneously.
   - **Impact:** Users are limited to one conversation at a time.

6. **File Management / Explorer**
   - Codex App has @mention file search. Conductor and Kilo Code have file trees. OpenCode has directory traversal. Pluribus has only a workspace directory picker.
   - **Impact:** No way to browse, reference, or attach project files from within the app.

7. **Skills / Extensibility System**
   - Codex App has a full skills system with team sharing. Kilo Code has custom modes + MCP marketplace. Conductor has scripts + slash commands. Pluribus has none.
   - **Impact:** No way to package reusable workflows or extend the agent's capabilities.

8. **Multi-Model Support**
   - OpenCode supports 75+ providers. Kilo Code supports 500+ models. Codex App offers model switching. Conductor supports Claude + Codex + OpenRouter. Pluribus is locked to Claude CLI.
   - **Impact:** Users can't choose the best model for their task or use cheaper models for simple tasks.

### Tier 3 -- Differentiating Gaps (1-2 competitors have these)

9. **Automations / Scheduled Tasks** (Codex App)
   - Background scheduled agent runs with inbox/triage system. No competitor besides Codex App has this fully built.

10. **Cloud Execution** (Codex App, Kilo Code)
    - Offload tasks to cloud containers for background processing.

11. **CI/CD Integration** (Codex App)
    - GitHub Action, SDK, programmatic API for pipeline integration.

12. **Voice Input** (Codex App, Kilo Code)
    - Hold-to-dictate for hands-free prompting.

13. **Conversation Forking / Compaction** (Codex App)
    - Fork a thread to explore alternatives. Compact long threads to free context.

14. **Slash Commands** (Conductor, Codex App)
    - Quick-access specialized workflows within the chat.

15. **Command Palette** (Codex App)
    - Cmd+K for fast access to all app features.

---

## What Pluribus Has That Others Don't

1. **Rich Dev Panel / Stream Analytics**
   - No competitor has anything close to Pluribus's dev panel: circular event buffer, context pressure visualization, session registry, MCP server status, event categorization. This is a genuine differentiator for power users and developers.

2. **5-Theme System**
   - Studio, Graphite, Sunset, Terminal, Paper. No competitor offers this level of visual customization.

3. **Thinking/Reasoning Block Display**
   - Pluribus renders Claude's `<thinking>` blocks as collapsible `<details>`. No competitor surfaces model reasoning this way.

4. **Cross-Platform Desktop (Tauri)**
   - Pluribus works on macOS, Windows, AND Linux today. Conductor is macOS-only. Codex App is macOS-only (Windows alpha). OpenCode is terminal-only. Kilo Code is editor-extension-only.

5. **Claude CLI Native Integration**
   - Direct access to Claude's full agent capabilities (tools, MCP, skills, slash commands) through the official CLI, with session resume/retry strategy.

6. **Layout System (Scaffolded)**
   - The Atelier Grid layout and Layout Lab infrastructure suggest a vision for customizable workspace layouts that no competitor has.

7. **Scratchpad (Scaffolded)**
   - A side panel for notes/scratch work alongside conversations. No competitor has this concept.

---

## Strategic Recommendations

### Quick Wins (High Impact, Moderate Effort)
1. **Integrated terminal** -- Embed xterm.js or similar per-thread. Huge usability win.
2. **Git diff viewer** -- Show Claude's file changes in a diff panel. Use the existing tool event data.
3. **File @mentions** -- Fuzzy file search in the composer to reference project files.
4. **Slash commands** -- Forward to Claude CLI's slash command system.

### Medium-Term (High Impact, Higher Effort)
5. **Git worktree isolation** -- Each thread gets its own worktree for safe parallel work.
6. **Parallel threads with concurrent agents** -- Allow multiple Claude CLI subprocesses.
7. **MCP configuration UI** -- Let users configure MCP servers from the app.
8. **Skills browser** -- Surface Claude CLI's skills system in the UI.

### Longer-Term (Differentiating)
9. **Automation system** -- Scheduled agent tasks with inbox (follow Codex App's model).
10. **Multi-model support** -- Allow switching between Claude models or other providers.
11. **Custom modes** -- Architect/Code/Debug mode switching (follow Kilo Code's model).
12. **Layout customization** -- Complete the Layout Lab vision with multiple layout options.
13. **Scratchpad** -- Complete the scratchpad as a persistent notes panel.

### Unique Positioning Opportunity
Pluribus sits in a unique niche: **a cross-platform desktop app with Claude CLI integration and rich developer analytics**. The recommendation is to lean into this by:
- Making the dev panel a first-class feature (not dev-only)
- Building the best git diff + review experience in the category
- Leveraging the Tauri desktop platform for features impossible in terminals or editor extensions (multi-window, drag-drop, native OS integration, system notifications)
- Completing the workspace layout vision as a genuinely unique differentiator

---

## Sources

### Conductor
- [Conductor Docs](https://docs.conductor.build/)
- [Conductor Homepage](https://www.conductor.build/)
- [Conductor Docs LLMs.txt](https://docs.conductor.build/llms.txt)
- [The New Stack: Hands-On Review of Conductor](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/)

### OpenAI Codex App
- [Codex App Documentation](https://developers.openai.com/codex/app/)
- [Codex App Features](https://developers.openai.com/codex/app/features/)
- [Introducing the Codex App | OpenAI](https://openai.com/index/introducing-the-codex-app/)
- [Codex App Review](https://developers.openai.com/codex/app/review/)
- [Codex Worktrees](https://developers.openai.com/codex/app/worktrees/)
- [Codex Automations](https://developers.openai.com/codex/app/automations/)
- [Codex Skills](https://developers.openai.com/codex/skills/)
- [Codex GitHub Action](https://developers.openai.com/codex/github-action/)
- [Codex SDK](https://developers.openai.com/codex/sdk/)
- [Codex Cloud](https://developers.openai.com/codex/cloud/)
- [Codex Models](https://developers.openai.com/codex/models/)
- [VentureBeat: OpenAI Launches Codex Desktop](https://venturebeat.com/orchestration/openai-launches-a-codex-desktop-app-for-macos-to-run-multiple-ai-coding)

### OpenCode
- [OpenCode Homepage](https://opencode.ai/)
- [GitHub: OpenCode](https://github.com/nicepkg/opencode)

### Kilo Code
- [Kilo Code Homepage](https://kilo.ai/)
- [Kilo Code App](https://www.kilocode.app/)
- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code)
- [GitHub: Kilo-Org/kilocode](https://github.com/Kilo-Org/kilocode)
- [XDA: Kilo Code Review](https://www.xda-developers.com/kilo-code-is-great-vs-code-extension/)
- [Kilo Code Review 2026](https://vibecoding.app/blog/kilo-code-review)
