# OMP Plan Kit

[![Latest release](https://img.shields.io/github/v/release/stgmt/omp-plan-kit?label=release)](https://github.com/stgmt/omp-plan-kit/releases)
[![License](https://img.shields.io/github/license/stgmt/omp-plan-kit)](https://github.com/stgmt/omp-plan-kit/blob/main/LICENSE)

**OMP Plan Kit is the planning kit for Oh My Pi (OMP): it keeps the plan proposed, approved,
executed, and later reviewed as the same plan.**

OMP Plan Kit provides deterministic stale-plan protection, structural plan validation, bounded
repair convergence, and native LLM review for OMP plan mode.

- **Deterministic preflight:** strict slug grammar, session-local path containment, and exact artifact existence checks.
- **Batch structural validation:** all independent structural errors returned in one actionable repair packet.
- **Bounded convergence:** strict limits on failures, unchanged files, and no-progress churn to prevent infinite correction loops.
- **Optional bounded advisor:** native OMP LLM review explains concrete defects without rewriting the plan.
- **Native review boundary:** only verified, approved plans reach OMP's human-review overlay.
- **Global installation:** install across OMP profiles via official plugin management.

## Quick start

### Install the released plugin as an OMP user

```bash
omp plugin install github:stgmt/omp-plan-kit#v1.2.0
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
          ├─ validate canonical sections (## Context, ## Approach, ## Verification)
          ├─ progress tracking (fewer issues vs churn, MAX_NO_PROGRESS_ATTEMPTS = 2)
          ├─ batch repair packet (MAX_FAILED_VALIDATIONS = 3)
          └─ sticky stop if budget exceeded (no ctx.abort overwrite)
                    │
                    ▼
          3. Optional Native Advisor (LLM exit-gate)
          ├─ in-session SHA-256 cache (zero extra tokens on repeat)
          ├─ budget check (max 3 calls per session, 160 tokens)
          ├─ bounded prompt + redacted plan excerpt
          └─ APPROVE or REJECT with concise critique
                    │
                    ▼
          4. OMP Native Review
          └─ open human review overlay (selectPlan)
```

## Plan structure contract

The validator parses Markdown level `##` headings outside of code fences:

### Mandatory sections (in exact canonical order)

1. `## Context` — problem description, current state, and background.
2. `## Approach` — step-by-step implementation changes and technical details.
3. `## Verification` — concrete commands and observable verification checks.

### Optional sections (strictly constrained placement)

- `## Critical files & anchors` — allowed once, strictly between `Approach` and `Verification`.
- `## Assumptions & contingencies` — allowed once, strictly after `Verification`.

Headings inside code fences (``` or ~~~) are ignored. Sections must contain non-whitespace body text. Dependent errors (e.g., reporting `SECTION_EMPTY` or `SECTION_ORDER` for a section that is already `SECTION_MISSING`) are suppressed.

## All-errors repair packet

When a plan violates the structural contract, the validator collects **all** independent issues in a single pass and returns a complete repair packet to the model:

```text
[PLAN_VALIDATOR_BLOCK] Plan validation failed (Attempt 1 of 3):

1. [SECTION_MISSING] Context: Required section "Context" is missing. Fix: Add "## Context" section to the plan.
2. [SECTION_ORDER] Approach, line 15: Section "Approach" at line 15 is out of order (must appear before "Verification"). Fix: Move "## Approach" before "## Verification".

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

The controller uses a **sticky turn latch** instead of calling `ctx.abort()`. In OMP, invoking `ctx.abort()` inside a `tool_call` hook aborts the operation and overwrites the structured error message with a generic abort failure, hiding the exact defect list from the model and user. The sticky turn latch preserves the full `[PLAN_VALIDATOR_STOPPED]` diagnostic in the transcript while ensuring all subsequent handoff attempts in that turn return immediately in $O(1)$ without disk reads, validation runs, or advisor calls.

### Reset on new prompt or native Refine

Starting a new user turn (`before_agent_start`) or triggering OMP's native `Refine plan` action increments `turnId`, clears turn/cycle blocks, and grants a fresh budget for the next iteration.

## Batch tool-call race condition

In OMP (`agent-loop.ts:2458-2469`), when a model outputs multiple tool calls in a single response (e.g. `write local://<slug>-plan.md` followed by `write xd://propose <slug>`), OMP executes all `tool_call` extension hooks **before** writing any file to disk.

Therefore, the plan file must be written in one turn, and `write xd://propose <slug>` must be called in a **subsequent turn** after the file write succeeds. Emitting both in the same batch triggers `PLAN_FILE_MISSING` by design.

## Optional native OMP advisor (exit-gate)

The advisor is an economical exit-gate that runs strictly after structural validation passes:

- **Zero tokens on invalid plans**: syntax and structural failures block before the advisor runs.
- **Cache**: an unchanged plan re-proposal hits an in-session `SHA-256` cache and spends zero additional tokens.
- **LLM review**: evaluates safety, repository boundaries, and concrete verification.
  - `REJECT` → hard block `[PLAN_ADVISOR_BLOCK] Советник отклонил план: <reason>`; agent stays in plan mode.
  - `APPROVE` → proposal passes through to OMP core dispatch.

Configuration:

| Variable | Default | Purpose |
|---|---:|---|
| `OMP_PLAN_ADVISOR` | `1` | Set `0` to disable only the LLM advisor |
| `OMP_PLAN_ADVISOR_MAX_CALLS` | `3` | Per-session advisor call cap |
| `OMP_PLAN_ADVISOR_COOLDOWN_MS` | `0` | Duplicate/cooldown window (0 = cache-only) |
| `OMP_PLAN_ADVISOR_TIMEOUT_MS` | `15000` | Native OMP model-call timeout |
| `OMP_PLAN_ADVISOR_MAX_TOKENS` | `160` | Output-token cap, clamped to 32–256 |
| `OMP_PLAN_ADVISOR_MODEL` | `@advisor` | OMP model or role resolved by `ctx.models` |

## Verification battery

All behavioral probes live in `tests/`:

```bash
bun tests/e2e-plan-validator.mjs          # batch structural validator contract
bun tests/e2e-convergence-controller.mjs  # convergence limits, progress, sticky latches
bun tests/e2e-programmer.mjs              # slug mutations, edge cases, profile loader
bun tests/e2e-advisor-contract.mjs        # advisor budget, token caps, cache deduplication
bun tests/e2e-real-plan-handoff.mjs       # real in-process OMP dispatch & review overlay
bun tests/e2e-advisor-live.mjs            # live model verification (gpt-5.6-sol)
```

Run all tests:

```bash
npm run check
bun tests/e2e-plan-validator.mjs && bun tests/e2e-convergence-controller.mjs && bun tests/e2e-programmer.mjs && bun tests/e2e-advisor-contract.mjs && bun tests/e2e-real-plan-handoff.mjs
```

### Rollback and reinstall

```bash
omp plugin uninstall omp-plan-kit
omp plugin install github:stgmt/omp-plan-kit#v1.1.0
```

## Repository map

```text
src/plan-validator.ts                  deterministic structural plan validator & repair packet
src/extension.ts                       convergence controller, preflight & advisor entrypoint
dist/extension.js                      shipped OMP plugin bundle
ROADMAP.md                             product direction and release gates
scripts/install-all-profiles.mjs       CLI install across current PC profiles
scripts/uninstall-all-profiles.mjs     CLI uninstall across current PC profiles
tests/e2e-plan-validator.mjs           structural validator tests (missing, duplicate, order, empty)
tests/e2e-convergence-controller.mjs   convergence tests (churn, repeats, slug hopping, reset)
tests/e2e-programmer.mjs               mutation and edge probe against OMP loader
tests/e2e-advisor-contract.mjs         advisor bounds, token caps, cache deduplication
tests/e2e-real-plan-handoff.mjs        real in-process handoff with OMP dispatchResolutionDevice
tests/e2e-advisor-live.mjs             live native model review verification
audit-reports/                         evidence, architecture decisions, and release notes
```

## Release

Current release: [`v1.2.0`](https://github.com/stgmt/omp-plan-kit/releases/tag/v1.2.0).

Release review report: `audit-reports/omp-plan-kit-v1.2.0-review-2026-09-04.md`.

License: MIT.
