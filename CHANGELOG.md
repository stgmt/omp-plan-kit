# OMP Plan Kit Changelog

All notable changes to OMP Plan Kit are documented here.

## [1.5.0] - 2026-09-05

### Added

- Machine-readable plan core: a plan MAY start with an optional JSON front-matter block (`--- { ... } ---`) carrying `sections.context` (string), `sections.approach` (array of `{ action, target }`), and `sections.verification` (array of `{ command, expects }`) — `src/plan-validator.ts` exports `parsePlanCore` and `PlanCore` types.
- When a valid core is present the validator checks the DATA and skips the Markdown path entirely: section-heading keys and body language become irrelevant. A plan whose body and headings are entirely in Russian (or any language) now passes with zero issues — the last language-coupled surface of the gate is gone for plans that opt in.
- Core violations return `PLAN_CORE_INVALID` with the exact field named (`sections.approach[0].target`, `sections.verification[0].expects`, ...), rendered in the repair packet.

### Changed

- Core block rules: must start at line 1 and close within the first 100 lines; a leading `---` without a closing fence falls back to the Markdown path; invalid JSON inside the block fails closed with `PLAN_CORE_INVALID` (never silently parsed as Markdown); unknown extra keys are ignored for forward compatibility.

### Compatibility

- Strictly opt-in and widening: plans without front-matter are validated exactly as in v1.4.0. Plan keys (`sections`, `context`, `approach`, `action`, `target`, `command`, `expects`) are format literals like YAML keys and are not translated; values are free language.
- Basis: competitor research (`audit-reports/research-competitor-plan-validation-2026-09-05.md`) — validation-by-construction (Spec Kit, Copilot Workspace) closes the parsing problem at the root; Gherkin-style keyword registries and LLM extraction were evaluated and rejected.

## [1.4.0] - 2026-09-05

### Changed

- `VERIFICATION_NOT_ACTIONABLE` form 2 is now positional and language-neutral (`src/plan-validator.ts`): a non-empty fenced command block must be followed (skipping blank lines) by a non-empty result line in ANY language. The language-specific marker token requirement (`Expected:` / `Ожидаемо:` in v1.2.0, `+ Ожидается:` in v1.3.1) is removed: markers are still accepted as ordinary result lines but are no longer required. A Markdown heading right after the block is structure, not a result, and does not qualify.
- `VERIFICATION_NOT_ACTIONABLE` repair hint now states the positional contract (any language; markers accepted but not required).
- This closes the unbounded i18n bug class of the marker whitelist: previously every natural language other than English/Russian produced the same rejection loop that exhausted the repair budget in production on 2026-09-05.

### Added

- Mutation suite scenarios for the positional contract: German and Chinese result lines pass; fenced block with nothing after it is rejected; heading after the block is rejected; empty fenced block stays rejected; blank line between block and result stays accepted. New mutants: restoring the marker requirement, accepting a heading as a result, and dropping the non-empty-block guard are all killed.
- Validator e2e cases: German/Chinese/positional result lines, blank-line tolerance, no-result and heading-after negative cases.

### Compatibility

- Strictly widening: every plan accepted by v1.3.1 remains accepted; plans with result lines in previously rejected languages now pass. No plan-format breaking changes.

## [1.3.1] - 2026-09-05

### Fixed

- Natural Russian verification token `Ожидается:` is now accepted by `VERIFICATION_NOT_ACTIONABLE` form 2 (`src/plan-validator.ts`); `Expected:` and the v1.3.0-documented `Ожидаемо:` remain accepted for backward compatibility. Bullet-list (`- `) and numbered (`1)`) continuations before the token stay supported.
- `SECTION_MISSING` repair hint now states that the heading line must be exactly `## Context` (English literal; translations, bilingual, or decorated headings are not matched). This is what the production session of 2026-09-05 tripped over: bilingual headings were attempted because the old hint read as "add a section about Context".
- `VERIFICATION_NOT_ACTIONABLE` repair hint now names every accepted token: `Expected:` / `Ожидается:` / `Ожидаемо:`.
- Turn budget (`MAX_TURN_PROPOSALS`) in `src/extension.ts` now counts only proposals that pass the deterministic preflight. Previously four malformed `xd://propose` payloads (full Markdown, empty, whitespace, path traversal) burned the whole per-turn budget and latched `PLAN_VALIDATOR_TURN_BLOCKED`, so a valid plan in the same turn could no longer be submitted; `tests/e2e-programmer.mjs` was failing on `origin/main` for exactly this reason.
- `tests/e2e-programmer.mjs` now proves the budget semantics end to end: malformed and missing-artifact rejections stay uncounted, four counted attempts pass, the 5th trips `PLAN_VALIDATOR_TURN_BLOCKED`, and the sticky latch answers further calls in constant time (schema `omp-plan-kit-programmer-e2e@3`).

### Added

- `tests/e2e-validator-mutations.mjs` (registered as `e2e:mutations` and in `e2e:all`/`check`): BDD scenario x mutation matrix. Ten Given/When/Then scenarios run against the real build (baseline) and against eleven source mutants (token alternation, bullet prefix, repair hints, heading exactness, immediate-Expected rule, budget ordering, budget bounds, sticky latch). Every mutant must be killed by at least one scenario; the suite fails otherwise.
- Validator e2e coverage for Russian tokens and hints: natural `Ожидается:` (plain and bulleted), exact-literal hint assertions, bilingual-heading rejection, token-list hint assertion.

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
