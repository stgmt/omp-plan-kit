# Research: "entering plan mode" hook — Claude Code model, prior art, and variants for omp-plan-kit

Date: 2026-09-06
Goal: implement a Claude-Code-style hook that fires when plan mode is entered, so plan-format rules land in the agent context automatically. Find prior art for pi/OMP.

## 1. How Claude Code does it (and doesn't)

- **EnterPlanMode: no hook exists.** Open feature request `anthropics/claude-code#21282` — PreToolUse/PostToolUse do not fire for plan-mode transitions; only regular tools trigger them.
- **ExitPlanMode IS hookable**: it is a regular tool, so `PreToolUse` with `matcher: "ExitPlanMode"` intercepts plan approval; the plan text/path are exposed to the hook. Community plan validators work exactly this way (`miospotdevteam/claude-control`, `kintecus/cc-tools`).
- **Rules injection** in the Claude Code community is done via `SessionStart` hooks (stdout is added to context): `kintecus/cc-tools` (SessionStart planning-rules injection + plan review), `naniiluja/ccf` (context/plan restore after start/clear/compaction), `alicicek/tale-mode` (SessionStart injector + phase gates), `HarmAalbers/claude-requirements-framework` (workflow enforcement hooks).

Mapping to OMP: Claude Code's `ExitPlanMode` interception == our existing `xd://propose` `tool_call` gate (already shipped since v1.2.0). The missing piece is the ENTER side — and OMP has the same gap as Claude Code's EnterPlanMode.

## 2. Prior art for pi / oh-my-pi

- **oh-my-pi issue `can1357/oh-my-pi#4163` (OPEN, triaged enhancement, 2026-07-01): "Expose a plan-mode enable/state API to plugins/extensions".** The maintainer's own analysis confirms, line by line, what our source research found: `get/setPlanModeState` live on `AgentSession` and are not re-exported; `before_agent_start` exposes only `prompt/images/systemPrompt`; an extension "can rewrite the system prompt but cannot toggle the plan-mode sandbox or detect it". Maintainer's proposed shape: read-only `getPlanModeState()` on `ExtensionContext` (explicitly "usable from `before_agent_start`"), mutation only on command contexts. Status: no code until the API direction is accepted.
- **Pi (upstream) community plan-mode extensions implement their OWN plan modes via `ExtensionAPI`** (registerCommand `/plan`, custom tools, prompt rules) rather than hooking a native mode: `@pi-vault/pi-plan`, `@narumitw/pi-plan-mode`, `@ifi/pi-plan` (oh-pi bundle, branch-aware), `pi-plan-extension`. Not applicable to OMP's native plan mode, but proves the ExtensionAPI pattern.
- No existing OMP marketplace plugin that hooks native plan-mode entry was found.

## 3. Variants for omp-plan-kit

### Variant A — `before_agent_start` + deterministic anchor detection (recommended, shippable now)
Detect plan mode by the stable `Plan mode active.` anchor in the per-turn system prompt (`prompts/system/plan-mode-active.md:2`, rendered at `session/agent-session.ts:5141`); when present, return `{ systemPrompt: [...event.systemPrompt, FORMAT_SECTION] }` (chained replacement, `types.ts:1100-1108`, runner `emitBeforeAgentStart`, consumed at `agent-session.ts:5655` via `setTurnSystemPromptOverride`).
- Pros: ships today on current OMP (>=17.3.7 per engines); deterministic (no model gating); zero operator setup; self fail-open.
- Cons: anchor is text — needs a version-drift watch (two anchors: `Plan mode active.` + `xd://propose`); upstream issue #4163 names this exact workaround as what the API would replace.
- Precedent: issue #4163 describes prompt-overlay injection as the current ecosystem workaround; ours hardens it with a deterministic trigger.

### Variant B — SessionStart-style unconditional injection (OMP `session_start` event)
Inject a short plan-format notice once per session regardless of mode (Claude Code `SessionStart` pattern).
- Pros: simplest; no detection.
- Cons: pollutes every non-plan turn; rules are standing context cost; does not react to plan-mode entry mid-session (plan mode can be entered after start). Not recommended as the primary mechanism.

### Variant C — upstream API (contribute to `oh-my-pi#4163`)
Implement `ctx.getPlanModeState()` (read-only) on `ExtensionContext` per the maintainer's sketch; then Variant A's detection becomes a flag check instead of an anchor scan.
- Pros: the proper long-term fix; maintainer already outlined API questions (read-only vs mutation; event payload snapshot; RPC contexts; `/plan <prompt>` path parity).
- Cons: upstream acceptance latency; OMP versions in the wild won't have it for a long time. A is required regardless as the fallback.

### Variant D — own plan mode à la pi extensions (`/plan-format` command wrapping entry)
Rejected: OMP has native plan mode; duplicating it fragments the sandbox (tool gating, plan model role, resolve handler) that `#enterPlanMode` installs.

### Variant E — operator `APPEND_SYSTEM.md`
Exists (always-on, operator-configured, documented in `omp://system-prompt-customization.md`). Rejected as the plugin mechanism (not plan-scoped, not shippable), fine as a manual stopgap.

## 4. Recommendation

Ship **A** in v1.6.0 (detection + prompt-append + repair-packet teaching), structured so that when **C** lands, detection swaps from anchor scan to `ctx.getPlanModeState()` behind one function. Keep the existing `xd://propose` gate as the ExitPlanMode-equivalent (already shipped).

## Sources

- anthropics/claude-code#21282 (EnterPlanMode/ExitPlanMode hooks request): https://github.com/anthropics/claude-code/issues/21282
- Claude Code hooks reference (ExitPlanMode tool hooking): https://code.claude.com/docs/en/hooks ; https://code.claude.com/docs/en/hooks-guide
- can1357/oh-my-pi#4163 (plan-mode API for extensions, maintainer analysis): https://github.com/can1357/oh-my-pi/issues/4163
- Pi community plan extensions: https://github.com/pi-vault/pi-plan ; https://github.com/narumiruna/pi-extensions ; https://github.com/ifiokjr/oh-pi ; https://github.com/khoafullstack/pi-plan-extension
- Claude Code community injectors: https://github.com/kintecus/cc-tools ; https://github.com/miospotdevteam/claude-control ; https://github.com/naniiluja/ccf ; https://github.com/alicicek/tale-mode ; https://github.com/HarmAalbers/claude-requirements-framework
- OMP prompt customization docs: `omp://system-prompt-customization.md`
