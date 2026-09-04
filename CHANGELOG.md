# OMP Plan Kit Changelog

All notable changes to OMP Plan Kit are documented here.

## [1.3.0] - 2026-09-04

### Added

- Deterministic Approach step target verification (`APPROACH_TARGET_MISSING` in `src/plan-validator.ts`):
  - Requires each step in `## Approach` to name an exact target using inline code outside code fences.
  - Supports path indicators (`/` or `\`), symbol anchors (`#`), namespaces (`::`), function calls (`name()`), identifier chains (`name.member`), and interface paths (`Name > Child`).
  - Partitions steps by H3 headings (`### Step`), top-level numbered list items (`1.` or `1)`), or evaluates the entire section as one step if neither is present.
  - Reports exact line numbers of missing targets and suggests concrete examples.
- Actionable verification proof validation (`VERIFICATION_NOT_ACTIONABLE` in `src/plan-validator.ts`):
  - Requires `## Verification` to contain at least one verifiable proof in either of two supported forms:
    1. `<action>` → `<observable expected result>` (accepts `→`, `=>`, `->`);
    2. Non-empty fenced code block followed immediately by `Expected: <result>` or `Ожидаемо: <result>`.
  - Non-CLI verification support: browser UI surfaces (e.g. `Settings > Billing`), API routes, and manual checks pass validation without requiring CLI commands.
- Extended test suites:
  - `tests/e2e-plan-validator.mjs` covers negative cases (`Update the validator`, `Run tests`), positive cases with inline code targets, fenced code blocks with `Expected:` / `Ожидаемо:`, UI plans without CLI, single-pass combined errors, and dependency suppression.
  - `tests/e2e-real-plan-handoff.mjs` verifies that non-actionable plans block at the validator level with 0 advisor calls, while clean UI-plans pass the validator, receive advisor approval, and reach native review overlay.
- Release workflow hardening (`.github/workflows/release.yml`):
  - Strictly requires remote tag to exist on origin before publishing.
  - Validates `PEELED_TAG_COMMIT == HEAD_COMMIT` to eliminate tag-to-commit divergence.
  - Invokes `gh release create` with `--verify-tag` and without `--target main`.

### Changed

- Single-pass validator reports both structural and actionability errors together in one structured repair packet.
- Suppresses dependent `APPROACH_TARGET_MISSING` and `VERIFICATION_NOT_ACTIONABLE` issues when sections are missing, empty, or duplicated.
- Migrated plan fixtures in `tests/e2e-advisor-contract.mjs`, `tests/e2e-advisor-live.mjs`, `tests/e2e-convergence-controller.mjs`, `tests/e2e-programmer.mjs`, and `tests/e2e-real-plan-handoff.mjs` to include exact targets and actionable verification proofs.
- `tests/e2e-real-plan-handoff.mjs` supports `OMP_PLAN_KIT_EXTENSION_PATH` for running against extracted release candidates.

## [1.2.0] - 2026-09-04

### Added

- Deterministic batch plan validator (`src/plan-validator.ts`): parses Markdown `##` headings outside code fences, enforces canonical sections (`Context`, `Approach`, `Verification` in order; optional `Critical files & anchors` and `Assumptions & contingencies`), suppresses dependent errors, and returns all independent issues in a structured repair packet.
- Convergence controller (`src/extension.ts`): tracks progress across proposals, distinguishing real issue reduction from hash churn, and enforces deterministic limits to eliminate infinite repair loops:
  - `MAX_FAILED_VALIDATIONS = 3`: maximum 3 failed validation attempts per slug;
  - `MAX_SAME_HASH_REPEATS = 2`: maximum 2 repeated proposals of an unchanged invalid plan;
  - `MAX_NO_PROGRESS_ATTEMPTS = 2`: maximum 2 consecutive proposals without decreasing issue count;
  - `MAX_TURN_PROPOSALS = 4`: maximum 4 proposals per turn across all slugs before turn-blocking (`[PLAN_VALIDATOR_TURN_BLOCKED]`).
- Sticky turn latch: preserves rich `[PLAN_VALIDATOR_STOPPED]` diagnostics in the model transcript without calling `ctx.abort()` (which would overwrite the failure reason with a generic abort error), while making all subsequent attempts in the turn fail fast in $O(1)$ without re-running the validator or advisor.
- Fresh turn budget reset: new user prompt or native `Refine plan` (`before_agent_start`) increments `turnId`, clears latches and cycles, and grants a fresh repair budget.
- Test suites: `tests/e2e-plan-validator.mjs` (unit + integration coverage for empty, missing, duplicate, order, fence, and minimal plans) and `tests/e2e-convergence-controller.mjs` (progress detection, churn cutoff, repeat cutoff, slug hopping, and turn reset).

### Changed

- Pipeline ordering: exact preflight → plan validator & convergence → advisor review → native OMP review overlay. Structurally invalid plans never invoke the LLM advisor, saving 100% of advisor tokens on malformed plans.
- Preflight failure reason for `PLAN_FILE_MISSING` clarifies OMP's batch tool-call execution semantics (all `tool_call` hooks fire before any tool writes files to disk), requiring separate turns for plan writing and `xd://propose`.
- Updated test fixtures in `tests/e2e-advisor-contract.mjs`, `tests/e2e-real-plan-handoff.mjs`, `tests/e2e-programmer.mjs`, and `tests/e2e-advisor-live.mjs` to conform to the structural plan contract.
- Maintained strict compatibility with `engines.omp >=17.3.7`.

## [1.1.0] - 2026-09-03

### Added

- Plan advisor exit-gate: the bounded LLM review now runs strictly at `write xd://propose <slug>` on the completed `local://<slug>-plan.md` artifact, reviewing the exact plan content against the user's objective/constraints.
- In-session plan-content cache (`SHA-256` of plan body): re-proposing an unchanged plan hits the cache and spends zero additional advisor tokens.
- Project rule `.omp/rules/tests.md`: concise test discipline — all tests must live in `tests/`.

### Changed

- Advisor trigger moved from intermediate `todo` scope suspicion to the plan handoff boundary. Intermediate planning steps (`todo`, reads, scratch edits) now spend zero advisor tokens.
- Deterministic syntax errors (malformed slug, traversal, missing artifact) block with `PLAN_HANDOFF_*` and zero advisor invocations, before any model call.
- Defective plans receive a hard block with `[PLAN_ADVISOR_BLOCK] Советник отклонил план: <reason>` and never reach the OMP human-review overlay; the agent remains in plan mode with corrective feedback.
- Clean plans approved by the advisor pass through to OMP core dispatch and open the operator review dialog unchanged.
- Coverage widened to four E2E suites: programmer mutations (8 cases), advisor contract (budget/bounds/cache), real in-process handoff with OMP `dispatchResolutionDevice`, and live native model verification on `openai-codex/gpt-5.6-sol`.

### Removed

- Removed `todo`-as-trigger for the advisor. The old `todo-scope-suspicion` path and its negative-scope regex are deleted.

### Technical

- Refactored `src/extension.ts`: removed tiny wrappers (`sessionIdFrom`, `compact`) and local `isRecord` to follow project lints; consolidated prompt/state handling around `userPrompt` + `cache`.
- Relocated E2E suites from `scripts/` to `tests/`; `scripts/` now contains only install/uninstall helpers.
- Added `audit-reports/plan-advisor-exit-gate-2026-09-03.md` with grounded evidence, architecture diagram, and E2E matrix.

## [1.0.1] - 2026-08-31

### Maintenance

- Aligns the release tag, package version, public install instructions, and final review evidence.
- Publishes the post-release review report in the same main line as the release candidate.

## [1.0.0] - 2026-08-31

### Released

- Declares OMP Plan Kit as the stable product name and installable OMP plugin.
- Ships the deterministic stale-plan handoff guard as the v1 foundation.
- Ships the bounded native OMP advisor with a hard 160-token cap and disabled reasoning.
- Ships the roadmap for plan lifecycle, structure, readability, plan-pomogator workflow, and OMP Spec Kit synchronization.
- Publishes manual installation, mutation, edge-case, rollback, and native advisor evidence.

## [0.2.1] - 2026-08-31

### Fixed

- Restored the Windows local-artifact path-length threshold used by the exact plan preflight.
- Manual E2E now exercises the artifact-root override path that caught the regression.

## [0.2.0] - 2026-08-31

### Changed

- Renamed the product, package, and repository from `omp-plan-protection` to `omp-plan-kit`.
- Added the product roadmap for plan lifecycle integrity, structure, readability, plan-pomogator
  workflow, and OMP Spec Kit synchronization.
- Updated public installation, search metadata, AI-readable project facts, and release references.
- Renamed the runtime receipt file to `omp-plan-kit-receipts.ndjson`.
- Kept the v0.1 deterministic handoff guard as the protected foundation of the kit.

## [0.1.1] - 2026-08-31

### Changed

- Manual programmer E2E loads the installed package through OMP's real loader for every existing profile.
- Exact plan-artifact preflight honors OMP's session artifact-root override.
- Advisor contract E2E verifies deduplication, todo triggering, and zero calls on the normal path.

## [0.1.0] - 2026-08-31

### Added

- OMP plugin package with `package.json#omp.extensions` and built `dist/extension.js`.
- Deterministic `xd://propose` pre-execution guard.
- Exact session-local plan artifact existence check and SHA-256 receipt.
- Bounded native OMP advisor with disabled reasoning and a 160-token output cap.
- Profile-aware install and uninstall helpers using the official OMP CLI.
- Manual programmer mutation/edge E2E and native advisor E2E probes.
- Source-grounded manual verification report.
