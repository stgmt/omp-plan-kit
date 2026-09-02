# OMP Plan Kit — Plan Advisor Exit Gate Audit & Refactoring

Date: 2026-09-03

## Verdict

**PASS**

The Plan Advisor in `omp-plan-kit` has been converted into an ultra-economical exit gate:
1. Intermediate operations (e.g. `todo`, code research, read, edit) spend strictly **0 advisor tokens**.
2. Syntax and format errors (malformed slugs, traversal attempts, missing files) block deterministically with **0 advisor tokens**.
3. The Plan Advisor runs strictly at plan proposal (`write xd://propose <slug>`), reviewing the completed plan artifact `local://<slug>-plan.md`.
4. Defective or boundary-violating plans are rejected with `[PLAN_ADVISOR_BLOCK]`, preventing OMP from opening the human review dialog and keeping the agent in plan mode.
5. Clean plans receive an approval verdict, pass through the guard, and reach OMP core dispatch (`dispatchResolutionDevice`).
6. Unchanged re-proposals hit the in-session content-hash cache, spending 0 extra tokens.
7. The repository test suite was relocated from `scripts/` into a dedicated `tests/` directory and verified end-to-end.

## Grounded Facts & Evidence

| Claim | Source File | Line / Evidence | Verdict |
|---|---|---|---|
| OMP has no native `exit_plan_mode` event in `ExtensionAPI` | `@oh-my-pi/pi-coding-agent/src/extensibility/extensions/types.ts` | 506–555 | Grounded |
| OMP dispatches plan submission via `write` to `xd://propose` | `@oh-my-pi/pi-coding-agent/src/tools/resolve.ts` | 290–311 | Grounded |
| Plan review dialog opens only if `xd://propose` tool call succeeds | `@oh-my-pi/pi-coding-agent/src/modes/controllers/event-controller.ts` | 76895–77590 | Grounded |
| Returning `{ block: true, reason }` halts execution before core dispatch | `@oh-my-pi/pi-coding-agent/src/extensibility/hooks/tool-wrapper.ts` | 42–74 | Grounded |
| Native OMP advisor runs on every turn unless restricted | `@oh-my-pi/pi-coding-agent/src/session/agent-session.ts` | 51329 | Grounded |
| Plan Advisor runs on `write xd://propose` with bounded tokens | `src/extension.ts` | 137–260 | Verified |

## Architecture & Trigger Seams

```
[Agent in Plan Mode]
         │
         ├── (Exploration, reading files, editing scratch notes, updating todo)
         │       └── Zero LLM Advisor Calls (0 tokens)
         │
         ▼
[Agent calls write xd://propose <slug>]
         │
         ├── 1. Deterministic Preflight (syntax, safety, file existence)
         │       └── Malformed/Missing -> Return [PLAN_HANDOFF_*] (0 tokens)
         │
         ▼
[Plan artifact local://<slug>-plan.md read from disk]
         │
         ├── 2. In-Session Hash Cache
         │       └── Identical SHA-256 already reviewed -> Return cached verdict (0 tokens)
         │
         ▼
[Plan Advisor Evaluation (Model @advisor / maxTokens 160 / disableReasoning true)]
         │
         ├── 3a. Rejection (Defective plan, scope violation, missing verification)
         │       └── Return { block: true, reason: "[PLAN_ADVISOR_BLOCK] ..." }
         │           ├── Human review overlay does NOT open
         │           ├── Core dispatch is NOT reached
         │           └── Agent stays in plan mode with feedback
         │
         └── 3b. Approval (Clean, viable plan)
                 └── Return undefined
                     ├── Core dispatch is reached (dispatchResolutionDevice)
                     └── Human review overlay opens with approved plan
```

## E2E Verification Matrix

All 4 test suites pass cleanly from `tests/`:

1. `tests/e2e-programmer.mjs`:
   - Enumerate all 3 profiles (`default`, `release-e2e`, `root-artifacts-release-proof`).
   - 8 mutation cases pass; unguarded core selects stale plan, guarded core selects exact plan.
2. `tests/e2e-advisor-contract.mjs`:
   - Syntax error -> 0 advisor calls.
   - `todo` updates -> 0 advisor calls.
   - Defective plan -> 1 advisor call (REJECT), blocks handoff.
   - Clean plan -> 1 advisor call (APPROVE), allows handoff.
   - Re-proposing unchanged plan -> 0 extra calls (cache hit).
3. `tests/e2e-real-plan-handoff.mjs`:
   - Full in-process integration with OMP `dispatchResolutionDevice` and `resolveApprovedPlan`.
   - Proves `coreSelectedPlan = null` when advisor blocks, and `coreSelectedPlan = "local://fixed-feature-plan.md"` when approved.
4. `tests/e2e-advisor-live.mjs`:
   - Live execution against real `openai-codex/gpt-5.6-sol` model.
   - Real model critiqued and blocked defective plan, and approved complete clean plan.
