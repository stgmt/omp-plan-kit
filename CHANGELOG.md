# OMP Plan Kit Changelog

All notable changes to OMP Plan Kit are documented here.

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
