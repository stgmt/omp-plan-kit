# OMP Plan Kit

[![Latest release](https://img.shields.io/github/v/release/stgmt/omp-plan-kit?label=release)](https://github.com/stgmt/omp-plan-kit/releases)
[![License](https://img.shields.io/github/license/stgmt/omp-plan-kit)](https://github.com/stgmt/omp-plan-kit/blob/main/LICENSE)

**OMP Plan Kit is the planning kit for Oh My Pi (OMP): it keeps the plan proposed, approved,
executed, and later reviewed as the same plan.**

OMP Plan Kit provides deterministic stale-plan protection, actionable plan contracts, structural
plan validation, bounded repair convergence, and native OMP review for plan mode.

- **Deterministic preflight:** strict slug grammar, session-local path containment, and exact artifact existence checks.
- **Batch structural & actionable validation:** all independent structural and actionability errors returned in one actionable repair packet.
- **Actionable plan contracts:** every Approach step names an exact target, and Verification contains observable, executable proof.
- **Bounded convergence:** strict limits on failures, unchanged files, and no-progress churn to prevent infinite correction loops.
- **Deterministic handoff:** validated plans are passed to OMP native review and watchdog logic; this plugin does not call an LLM.
- **Native review boundary:** only deterministically validated plans reach OMP's human-review overlay.
- **Killer feature — user-friendly Enter Plan Mode hook:** plugins can subscribe to `omp-plan-kit:enter-plan-mode`; OMP Plan Kit uses the same event to inject the mandatory machine-readable plan-core template and activate session-scoped enforcement.
- **Global installation:** install across OMP profiles via official plugin management.

## Roadmap status

### Delivered killer feature: user-friendly Enter Plan Mode hook

The first major roadmap milestone is complete. OMP Plan Kit now publishes the synchronous
`omp-plan-kit:enter-plan-mode` event on OMP's shared event bus. External OMP extensions can
subscribe by channel name without importing this plugin.

The built-in listener uses the same event to:

- inject the exact machine-readable plan-core template;
- activate a session-scoped requirement for that core;
- keep one instruction per activation; and
- require the core when that session later submits `xd://propose`.

This keeps the extension boundary simple: one public event, one shared contract, and no
plugin-specific mode detector. The hook is covered by real-loader, load-order, duplicate,
failure-isolation, ACP, and mutation tests.

## Quick start

### Install the released plugin as an OMP user

```bash
omp plugin install github:stgmt/omp-plan-kit#v1.7.0
```

OMP isolates named profiles. For every existing profile on this PC, run the profile-aware
installer from a checkout:

```bash
node scripts/install-all-profiles.mjs
```

Restart OMP after installing or upgrading an extension package.

### Verify installation

```bash
omp plugin list --json
omp plugin doctor --json
```

For a named profile:

```bash
omp --profile live-test plugin list --json
```

## Public enter-plan-mode hook

After installation, OMP Plan Kit publishes `omp-plan-kit:enter-plan-mode` on OMP's shared
`ExtensionAPI.events` bus. Another extension can subscribe by channel name; no import from
`omp-plan-kit` is required:

```ts
pi.events.on("omp-plan-kit:enter-plan-mode", (raw) => {
  const event = raw as {
    apiVersion: 1;
    sessionId: string;
    activationId: string;
    planFilePath?: string;
    addInstruction(input: { id: string; content: string }): void;
  };

  if (event.apiVersion !== 1) return;
  event.addInstruction({
    id: "example-plugin:planning-rules",
    content: "Keep each implementation step bound to an exact code target.",
  });
});
```

The event marks the first model request after entering plan mode, not the `/plan` UI action.
Call `addInstruction` synchronously before the listener returns; OMP's shared event bus does not
await asynchronous listeners. Instruction IDs are activation-scoped and first-wins on duplicates.
OMP Plan Kit subscribes to this same public event. Its built-in listener injects the exact
`PLAN_CORE_TEMPLATE` and records that the session must supply that core at handoff. Missing,
malformed, or incomplete cores block before OMP's native review and before its human-review overlay.
Sessions that never receive this event retain the legacy Markdown contract. The plugin does not
claim a native `pi.on("enter_plan_mode")` event.

## Runtime pipeline

Handoff follows a strict four-stage pipeline when exiting plan mode (`write xd://propose <slug>`):

```text
OMP write(path=xd://propose, content=<slug>)
                    │
                    ▼
          1. Exact Preflight (0 tokens)
          ├─ strict slug format (1-120 chars)
          ├─ resolve local://<slug>-plan.md
          ├─ path traversal / containment check
          ├─ file existence and regular-file check
          └─ compute SHA-256
                    │
                    ▼
          2. Plan Validator & Convergence (0 tokens)
          ├─ sticky turn latch check (MAX_TURN_PROPOSALS = 4)
          ├─ unchanged SHA check (MAX_SAME_HASH_REPEATS = 2)
          ├─ require the injected JSON plan core for activated Plan Mode sessions (PLAN_CORE_REQUIRED)
          ├─ validate core JSON and required fields (PLAN_CORE_INVALID)
          ├─ otherwise validate canonical Markdown sections (## Context, ## Approach, ## Verification)
          ├─ validate Approach step targets (APPROACH_TARGET_MISSING)
          ├─ validate Verification actionable proof (VERIFICATION_NOT_ACTIONABLE)
          ├─ progress tracking (fewer issues vs churn, MAX_NO_PROGRESS_ATTEMPTS = 2)
          ├─ batch repair packet (MAX_FAILED_VALIDATIONS = 3)
          └─ sticky stop if budget exceeded (no ctx.abort overwrite)
                    │
                    ▼
          3. OMP Native Review
          └─ open human review overlay (selectPlan)
```

## Plan structure contract

For a session observed through `omp-plan-kit:enter-plan-mode`, the plan MUST begin on line 1 with
this machine-readable JSON front matter. Replace placeholder values; keep every key unchanged:

```text
---
{
  "sections": {
    "context": "<task description, any language>",
    "approach": [
      {
        "action": "<what to do>",
        "target": "<exact file, symbol, route, or UI path>"
      }
    ],
    "verification": [
      {
        "command": "<command or exact verification surface>",
        "expects": "<observable result, any language>"
      }
    ]
  }
}
---
```

A missing core returns `PLAN_CORE_REQUIRED`; malformed JSON or incomplete fields return
`PLAN_CORE_INVALID`. Both block before OMP native review. A valid core is the authoritative data
path, so prose after it may use any headings or language.

For compatibility, sessions that did not receive the Plan Mode event continue through the existing
Markdown validator. It parses level `##` headings outside code fences:

### Mandatory Markdown sections (in exact canonical order)

1. `## Context` — problem description, current state, and background.
2. `## Approach` — step-by-step implementation changes and technical details with exact targets.
3. `## Verification` — concrete actions and observable verification proofs.

### Optional sections (strictly constrained placement)

- `## Critical files & anchors` — allowed once, strictly between `Approach` and `Verification`.
- `## Assumptions & contingencies` — allowed once, strictly after `Verification`.

Headings inside code fences (``` or ~~~) are ignored. Sections must contain non-whitespace body text. Dependent errors (e.g., reporting `SECTION_EMPTY`, `APPROACH_TARGET_MISSING`, or `VERIFICATION_NOT_ACTIONABLE` for a section that is missing or duplicate) are suppressed.

### Actionable plan guarantees (v1.3.0)

1. **Approach step targets (`APPROACH_TARGET_MISSING`):**
   - Each step in `Approach` must contain at least one inline code token specifying an exact target outside code fences:
     - Path indicators: `/` or `\` (e.g. `src/file.ts`, `GET /api/orders`, `.\build\run.exe`);
     - Anchor / symbol delimiters: `#` (e.g. `src/plan-validator.ts#validatePlanStructure`);
     - Namespace delimiters: `::` (e.g. `crate::module::func`);
     - Function calls: `name()` (e.g. `validatePlanStructure()`);
     - Identifier chains: `name.member` (e.g. `PlanIssue.code`, `package.json`);
     - Interface paths: `Name > Child` (e.g. `Settings > Billing`).
   - Steps are partitioned by H3 headings (`### Step`); if absent, by top-level numbered list items (`1.` or `1)`); if neither is present, the entire section is evaluated as a single step.

2. **Actionable verification proof (`VERIFICATION_NOT_ACTIONABLE`):**
   - The `Verification` section must contain at least one verifiable proof in either of two supported forms:
     - **Inline action + result:** `<command or exact surface>` → `<observable expected result>` (also accepts `=>` or `->`);
     - **Fenced command + expectation:** a non-empty fenced code block followed immediately by `Expected: <observable result>` or `Ожидаемо: <observable result>`.
   - Actions are not restricted to CLI: API routes, browser UI screens (e.g. `Settings > Billing`), TUI states, and manual checks are fully supported.

## All-errors repair packet

When a plan violates the structural or actionability contract, the validator collects **all** independent issues in a single pass and returns a complete repair packet to the model:

```text
[PLAN_VALIDATOR_BLOCK] Plan validation failed (Attempt 1 of 3):

1. [APPROACH_TARGET_MISSING] Approach, line 4: Approach step at line 4 has no exact target. Fix: Add an exact target using inline code, e.g. `src/file.ts#symbol`, `GET /api/orders`, `Settings > Billing`.
2. [VERIFICATION_NOT_ACTIONABLE] Verification, line 6: Verification has no actionable proof. Fix: Add <command or exact surface> → <observable expected result>, or a fenced command followed by Expected: <observable result>.

Fix every issue above in local://<slug>-plan.md, keep the same slug, reread the complete plan, and do not call xd://propose until all listed issues are fixed.
```

## Bounded convergence and turn limits

To protect against infinite repair loops and wasted context, the controller enforces hard, deterministic limits:

| Limit | Value | Behavior on limit |
|---|---|---|
| `MAX_FAILED_VALIDATIONS` | 3 | Sticky stop for this slug; model told to wait for operator feedback |
| `MAX_SAME_HASH_REPEATS` | 2 | Sticky stop when proposing unchanged invalid plan without edits |
| `MAX_NO_PROGRESS_ATTEMPTS` | 2 | Sticky stop when hash changes but issue count does not decrease |
| `MAX_TURN_PROPOSALS` | 4 | 5th proposal in a turn sets `turn.blocked = true` (`[PLAN_VALIDATOR_TURN_BLOCKED]`) |

### Sticky turn latch vs `ctx.abort()`

The controller uses a **sticky turn latch** instead of calling `ctx.abort()`. In OMP, invoking `ctx.abort()` inside a `tool_call` hook aborts the operation and overwrites the structured error message with a generic abort failure, hiding the exact defect list from the model and user. The sticky turn latch preserves the full `[PLAN_VALIDATOR_STOPPED]` diagnostic in the transcript while ensuring all subsequent handoff attempts in that turn return immediately in $O(1)$ without disk reads, validation runs, or model calls.

### Reset on new prompt or native Refine

Starting a new user turn (`before_agent_start`) or triggering OMP's native `Refine plan` action increments `turnId`, clears turn/cycle blocks, and grants a fresh budget for the next iteration.

## Batch tool-call race condition

In OMP (`agent-loop.ts:2458-2469`), when a model outputs multiple tool calls in a single response (e.g. `write local://<slug>-plan.md` followed by `write xd://propose <slug>`), OMP executes all `tool_call` extension hooks **before** writing any file to disk.

Therefore, the plan file must be written in one turn, and `write xd://propose <slug>` must be called in a **subsequent turn** after the file write succeeds. Emitting both in the same batch triggers `PLAN_FILE_MISSING` by design.

## Native OMP review boundary

OMP Plan Kit performs deterministic checks only. It does not call a plan-specific language model.

- Invalid, malformed, or non-actionable plans stop before OMP core dispatch.
- Valid plans pass to OMP native review and watchdog logic unchanged.
- The plugin has no plan-review model budget, model cache, or model configuration.

## Verification battery

All behavioral probes live in `tests/`:

```bash
bun tests/e2e-plan-mode-hook.mjs         # shared event, activation lifecycle, and external consumer
bun tests/e2e-plan-mode-hook-mutations.mjs # mutation protection for detection, event bus, and deduplication
bun tests/e2e-plan-validator.mjs          # batch structural & actionability validator contract
bun tests/e2e-validator-mutations.mjs     # BDD scenario x mutation matrix (every mutant must die)
bun tests/e2e-convergence-controller.mjs  # convergence limits, progress, sticky latches
bun tests/e2e-programmer.mjs              # slug mutations, edge cases, profile loader
bun tests/e2e-real-plan-handoff.mjs       # real in-process OMP dispatch & review overlay
```

Run all tests:

```bash
npm run check
bun tests/e2e-plan-mode-hook.mjs && bun tests/e2e-plan-mode-hook-mutations.mjs && bun tests/e2e-validator-mutations.mjs && bun tests/e2e-plan-validator.mjs && bun tests/e2e-convergence-controller.mjs && bun tests/e2e-programmer.mjs && bun tests/e2e-real-plan-handoff.mjs
```

### Rollback and reinstall

```bash
omp plugin uninstall omp-plan-kit
omp plugin install github:stgmt/omp-plan-kit#v1.2.0
```

## Repository map

```text
src/plan-validator.ts                  deterministic structural & actionability plan validator
src/extension.ts                       convergence controller, preflight & native OMP handoff
src/plan-mode-hook.ts                    public plan-mode event broker and instruction injection
dist/extension.js                      shipped OMP plugin bundle
ROADMAP.md                             product direction and release gates
scripts/install-all-profiles.mjs       CLI install across current PC profiles
scripts/uninstall-all-profiles.mjs     CLI uninstall across current PC profiles
tests/e2e-plan-mode-hook.mjs          real-loader public hook and external consumer tests
tests/e2e-plan-mode-hook-mutations.mjs mutation coverage for the plan-mode broker
tests/e2e-plan-validator.mjs           structural & actionable validator tests
tests/e2e-validator-mutations.mjs      BDD scenarios that kill source mutations of the gate
tests/e2e-convergence-controller.mjs   convergence tests (churn, repeats, slug hopping, reset)
tests/e2e-programmer.mjs               mutation and edge probe against OMP loader
tests/e2e-real-plan-handoff.mjs        real in-process handoff with OMP dispatchResolutionDevice
audit-reports/                         evidence, architecture decisions, and release notes
```

## Plan format contract

A plan submitted through `xd://propose` is validated in one of two ways.

**1. Machine-readable core (mandatory after Enter Plan Mode).** If the plan starts with a JSON front-matter block, the validator checks the data and skips Markdown parsing entirely — headings and body language become irrelevant:

```markdown
---
{
  "sections": {
    "context": "<task description, any language>",
    "approach": [{ "action": "<what to do>", "target": "<exact file/symbol/route>" }],
    "verification": [{ "command": "<command>", "expects": "<observable result, any language>" }]
  }
}
---
(any plan body in any language)
```

- Keys (`sections`, `context`, `approach`, `action`, `target`, `command`, `expects`) are format literals, like YAML keys: they are not translated. Values are free language.
- The block must start at line 1 and close within the first 100 lines. Invalid JSON inside it fails closed (`PLAN_CORE_INVALID`), never silently parsed as Markdown. Unknown extra keys are ignored.

**2. Markdown plan (compatibility path).** Without front-matter, the canonical section contract applies: heading lines `## Context`, `## Approach`, `## Verification` (exact English literals — section keys are format identifiers, like Kiro's EARS keywords or Spec Kit templates; they are not translated), approach steps with exact targets, and actionable verification proofs: inline `` `command` → result `` or a fenced command block followed immediately by a result line in any language (marker words like `Expected:` are accepted but not required).

## Release

Current release: [`v1.7.0`](https://github.com/stgmt/omp-plan-kit/releases/tag/v1.7.0).

Release review report: `audit-reports/omp-plan-kit-v1.7.0-review-2026-09-06.md`.

License: MIT.
