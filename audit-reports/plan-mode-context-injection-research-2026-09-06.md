# Research: injecting plan-format rules into agent context on plan-mode entry (OMP source-grounded)

Date: 2026-09-06
Question (owner): is there an "entering plan mode" event in OMP so omp-plan-kit could push plan-format rules (JSON core + Markdown contract) into the agent's context automatically?
Method: every claim below is grounded in the installed runtime source (`C:\Users\stigm\.omp\plugins\node_modules\@oh-my-pi\pi-coding-agent\src`, runtime 18.x) with file:line evidence. No claims from memory.

## Facts table

| # | Claim | Evidence |
|---|---|---|
| F1 | There is NO plan-mode-specific extension event. Full extension event list: `resources_discover`, `session_*`, `context`, `before_provider_request`, `after_provider_response`, `before_agent_start`, `agent_start/end`, `session_stop`, `turn_*`, `message_*`, `tool_execution_*`, `auto_compaction_*`, `auto_retry_*`, `retry_*`, `ttsr_triggered`, `todo_reminder`, `goal_updated`, `input`, `tool_approval_requested`, ... | `extensibility/extensions/types.ts` — all `on(event: "...")` signatures (~line 1210-1280) |
| F2 | Plan-mode state lives in `AgentSession.#planModeState: PlanModeState \| undefined`; `PlanModeState = { enabled, planFilePath, workflow?, reentry? }`; public accessor `AgentSession.getPlanModeState()` at line 4842; setter `setPlanModeState()` at 4851 | `plan-mode/state.ts:1-6`; `session/agent-session.ts:503, 4842, 4851` |
| F3 | Extensions receive `ctx.sessionManager: SessionManager` — the persistence class (`session/session-manager.ts:457`), which has NO plan-mode accessors (no `planModeEnabled`, no `getPlanModeState`). UI layer keeps its own flag (`modes/interactive-mode.ts`, `#enterPlanMode` at 2688). So an extension CANNOT read a plan-mode flag from ctx | `extensibility/extensions/types.ts` `ExtensionContext.sessionManager`; `session/session-manager.ts:457` |
| F4 | But the per-turn system prompt IS exposed: `BeforeAgentStartEvent = { type, prompt, images?, systemPrompt: string[] }` — full system prompt for this turn | `extensibility/extensions/types.ts:712-718` |
| F5 | And it is REPLACEABLE: `BeforeAgentStartEventResult = { message?: CustomMessagePayload; systemPrompt?: string[] }` — "Replace the system prompt for this turn. If multiple extensions return this, they are chained." | `extensibility/extensions/types.ts:1100-1108` |
| F6 | Runner mechanics: `emitBeforeAgentStart(prompt, images, systemPrompt)` passes `currentSystemPrompt` to each handler in order; any returned `systemPrompt` becomes the new `currentSystemPrompt` (chained); `result.message` payloads are collected | `extensibility/extensions/runner.ts`, `emitBeforeAgentStart` (~char 63947) |
| F7 | In plan mode the system prompt contains the rendered `prompts/system/plan-mode-active.md` (imported at `session/agent-session.ts:166`, rendered via `prompt.render(planModeActivePrompt, { planFilePath, ... })` at ~:5141). The rendered text begins with `<critical>\nPlan mode active.` — a stable detection anchor | `session/agent-session.ts:166, 5141`; `prompts/system/plan-mode-active.md:1-3` |
| F8 | The event result is consumed first-class by the session: `result.systemPrompt -> this.#tools.setTurnSystemPromptOverride(result.systemPrompt)`; otherwise `clearTurnSystemPromptOverride()` + `agent.setSystemPrompt(base)`. `result.messages` are appended to the turn as custom messages | `session/agent-session.ts:5635-5660` |
| F9 | Failure semantics of the event are FAIL-OPEN: handler throw -> logged + `emitError` -> skipped (no `onFailure` passed for this event); timeout -> warn + skip; abort -> skipped. The turn proceeds with the unmodified prompt | `extensibility/extensions/runner.ts`, `#runHandlerWithTimeout` (catch/timeout branches) |
| F10 | `ctx.getSystemPrompt(): string[]` also exists on ExtensionContext (current effective prompt) — an alternative detection source | `extensibility/extensions/types.ts`, ExtensionContext |
| F11 | `session_before_compact` exposes `customInstructions` to extensions, and plan mode deliberately pipes "Approve and compact context" guidance as `internalGuidance` so extensions don't mistake it for operator intent (issue #4359) — precedent that plan mode communicates with extensions via dedicated, documented channels | `extensibility/extensions/types.ts:385-401` (comment block) |

## Answers

**A1. There is no `plan_mode_enter` event.** Plan-mode entry (`#enterPlanMode`, `modes/interactive-mode.ts:2688`) mutates UI + session internals and swaps the system prompt; it emits no extension event.

**A2. But the goal is achievable without one.** `before_agent_start` fires on every user prompt with the full per-turn system prompt (F4). In plan mode that prompt contains the stable anchor `Plan mode active.` (F7). An extension can therefore:
1. detect plan mode by scanning `event.systemPrompt`;
2. return `{ systemPrompt: [...event.systemPrompt, PLAN_FORMAT_SECTION] }` — a chained prompt replacement appending the plan-format contract (JSON core example + Markdown contract + repair-packet meaning).

This gives every plan-mode turn the rules "in the header" (system prompt) with zero operator setup. Outside plan mode the extension returns `undefined` and nothing changes.

**A3. Alternative channel**: `BeforeAgentStartEventResult.message` injects a one-shot custom message (used by the runner/agent-session, F6/F8) — better suited for a one-time notice than standing rules. `context` event (`ContextEvent.messages`, deep copy, safe to modify — `extensibility/shared-events.ts:179`) can also append, but mutating messages is heavier than a prompt-section append.

## Proposed design (omp-plan-kit v1.6.0)

```
agent prompt (user turn)
        │
        ▼
AgentSession.#buildSystemPromptForAgentStart()          agent-session.ts:5629
        │  (plan mode: prompt includes plan-mode-active.md)
        ▼
extensionRunner.emitBeforeAgentStart(...)               agent-session.ts:5636
        │
        ▼
omp-plan-kit extension: handleBeforeAgentStart
  1. detect: event.systemPrompt.join("\n").includes("Plan mode active.")
     - not found -> return undefined (non-plan turn: zero changes)
  2. already injected (marker section present) -> return undefined (idempotent)
  3. try { return { systemPrompt: [...event.systemPrompt, formatSection] } }
     catch -> return undefined (self-implemented fail-open; F9 is fail-open by default)
        │
        ▼
setTurnSystemPromptOverride(chained prompt)             agent-session.ts:5655
```

`formatSection` content: the plan format contract — two paths (JSON core with the exact minimal example; Markdown path with heading keys and positional verification), one line on repair-packet semantics (attempts budget, same-slug repair), one line pointing to the plugin README. Deterministic text, no LLM calls, ~1.5 KB.

## Failure-mode table

| Failure mode | Behavior | Mitigation |
|---|---|---|
| Handler throws (bug) | Event is fail-open (F9): turn proceeds with unmodified prompt; error logged via `emitError` | Handler wraps everything in try/catch and returns `undefined` on any doubt |
| Handler timeout | Warn + skip; turn proceeds (F9) | Pure synchronous string work; no awaits needed |
| OMP renames the `Plan mode active.` anchor | Detection silently stops -> rules not injected; validator still enforces format via repair packets (behavior degrades to today's state) | Match two anchors (`Plan mode active.` + `xd://propose`); add startup `ctx.getSystemPrompt()` probe; tracked as probe З-2 |
| Another extension also replaces the prompt | Chaining is ordered by extension registration; our append uses the `event.systemPrompt` we receive, so upstream replacements are preserved | Keep append-only semantics, never truncate |
| Non-plan turns | Detection fails -> `undefined` -> no changes | — |

## Rejected alternatives

| Alternative | Why rejected |
|---|---|
| Ship rules via plugin-bundled `.omp/rules` | Plugin manifest ships `dist/extension.js` (`package.json#omp.extensions`); no evidence of a rules-shipping channel in the plugin contract (probe З-4 to double-check before ever relying on it) |
| `context` event message mutation | Heavier, message-level rather than prompt-level; standing rules belong in the system prompt |
| Require operators to add project rules manually | Works today but defeats "knowledge ships with the plugin" — the owner's requirement |
| Inject on `session_start` | Rules would predate plan mode and pollute non-plan turns |

## Probes

- З-1 (blocking, before code): pin the exact rendered anchor(s) of `plan-mode-active.md` in this runtime build — confirm `Plan mode active.` survives `prompt.render` substitution. Evidence source: `prompts/system/plan-mode-active.md:2` + `session/agent-session.ts:5141`.
- З-2 (non-blocking): version-drift watch for the anchor text in future OMP upgrades; add a second anchor `xd://propose` as a fallback match.
- З-3 (non-blocking): measure whether the appended section hits the prompt cache: plan mode already invalidates the cache on entry (comment at `modes/interactive-mode.ts:2740-2743`); our section is added on the same turn and stays constant — expected zero extra misses.
- З-4 (non-blocking): re-check the plugin manifest contract for a bundled-rules channel before ever considering option 3.

## Work order (v1.6.0)

1. `src/extension.ts`: register `before_agent_start` handler next to `tool_call` (default export `planProtection(pi)` — line ~525); detection + append + idempotency marker; self fail-open.
2. `formatSection` as a constant (deterministic contract text; both paths; repair-packet meaning).
3. E2E: unit-test the handler (plan-mode prompt in/out, non-plan passthrough, idempotency, failure -> undefined); loader test that the extension registers two handlers.
4. Mutation suite: mutant "drop plan-mode detection" killed by a scenario asserting rules appended only for plan-mode prompts; mutant "inject on non-plan turns" killed by passthrough scenario.
5. Release v1.6.0 per the standard integrity process.

## Acceptance scenarios

1. Plan mode on -> first and every subsequent turn's system prompt ends with the plan-format section; off -> prompt untouched.
2. Rules never appear in non-plan turns.
3. Handler exception -> turn completes normally, error logged, no rules (degradation equals current behavior).
4. Deterministic validation unchanged: tool_call gate behavior byte-identical; all existing suites green.

## Sources

All evidence paths are into the installed runtime source tree `C:\Users\stigm\.omp\plugins\node_modules\@oh-my-pi\pi-coding-agent\src\`:
`extensibility/extensions/types.ts` (715, 1100-1108, 1210+), `extensibility/extensions/runner.ts` (`emitBeforeAgentStart`, `#runHandlerWithTimeout`), `session/agent-session.ts` (166, 1000, 1017, 4842, 4851, 5141, 5635-5660), `plan-mode/state.ts`, `prompts/system/plan-mode-active.md`, `modes/interactive-mode.ts` (2688), `session/session-manager.ts` (457).
