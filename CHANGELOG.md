# Changelog

All notable changes to OMP Plan Protection are documented here.

## [0.1.1] - 2026-08-31

### Changed

- Manual programmer E2E now loads and exercises the installed package in every existing OMP profile.
- Exact local artifact resolution honors OMP's session artifact root override.
- Advisor E2E uses the OMP host model API seam and verifies deduplication, todo triggering, and zero calls on the normal path.

## [0.1.0] - 2026-08-31

### Added

- OMP plugin package with `package.json#omp.extensions` and built `dist/extension.js`.
- Deterministic `xd://propose` pre-execution guard.
- Exact session-local plan artifact existence check and SHA-256 receipt.
- Bounded native OMP advisor with disabled reasoning and a 160-token output cap.
- Profile-aware install and uninstall helpers using the official OMP CLI.
- Manual programmer mutation/edge E2E and native advisor E2E probes.
- Source-grounded manual verification report.
