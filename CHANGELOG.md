# OMP Plan Kit Changelog

All notable changes to OMP Plan Kit are documented here.

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
