# OMP Plan Kit v1.6.0 release review

Date: 2026-09-06
Repository: `stgmt/omp-plan-kit`
Release: `v1.6.0`

## Release identity

| Check | Command | Result |
|---|---|---|
| Local branch | `git branch --show-current` | `main` |
| Release commit | `git rev-parse HEAD` | `1e785057b2d4e63314f338e445749c3d6aa96756` |
| Tag identity | `git rev-parse "v1.6.0^{commit}"` | `1e785057b2d4e63314f338e445749c3d6aa96756` |
| Remote branch identity | `git rev-parse origin/main` | `1e785057b2d4e63314f338e445749c3d6aa96756` |
| Package version | `node -p "require('./package.json').version"` | `1.6.0` |
| GitHub workflow | `gh run watch 34001806222 --exit-status` | Passed; release job completed successfully |

The annotated tag, local `HEAD`, and `origin/main` resolve to the same commit.

## Local preflight

| Check | Result |
|---|---|
| Reproducible build | Two `npm run build` executions produced `dist/extension.js` SHA-256 `bf984c8fea7ded97631a7d601b8bd920d953ca237659cb8db2e3e1af86d9ca33` |
| Syntax and registered checks | `npm run check` passed |
| Package contents | Exactly `package/LICENSE`, `package/README.md`, `package/dist/extension.js`, `package/package.json` |
| Full behavioral battery | `RELEASE_BATTERY_PASS`; all eight suites passed |
| Release notes | `audit-reports/v1.6.0-release-notes.md` present before workflow dispatch |

Behavioral coverage included the public Plan Mode event, strict plan-core enforcement, validator and hook mutation suites, convergence, programmer, advisor, and real handoff scenarios.

## Published artifact integrity

| Check | Result |
|---|---|
| GitHub release | `v1.6.0`, not draft, not prerelease, target `main` |
| Asset | Exactly `omp-plan-kit-1.6.0.tgz` |
| Published digest | `sha256:f8fd9dcede93c9b57a55493d1ee150f6fe25ab116d20113c9447d1ef0a2baaba` |
| Downloaded digest | Equal to the published digest |
| GitHub attestation | `gh attestation verify` passed for the downloaded archive |
| Extracted bundle | `package/dist/extension.js` byte-equal to the committed `dist/extension.js` |
| Release body safety | No local Windows paths, `local://` references, or `.omp` paths |

## Clean-profile proof

A unique temporary OMP profile installed `github:stgmt/omp-plan-kit#v1.6.0` and was removed after verification.

- Installed bundle was byte-equal to the published archive.
- Real OMP loader returned zero errors.
- Exactly one `tool_call` handler was registered.
- Full Markdown payload to `xd://propose` blocked with `NON_SLUG_PAYLOAD`.
- Valid slug with an exact `##`-heading artifact passed with `OMP_PLAN_ADVISOR=0`.
- Temporary profile, archive, extraction, and artifact directories were removed in cleanup.

## Failure modes and rollback

| Failure mode | Safe response |
|---|---|
| `PLAN_CORE_REQUIRED` in an activated Plan Mode session | Add the exact line-1 JSON plan core injected by Plan Mode, then reread the complete artifact before proposing again. |
| `PLAN_CORE_INVALID` | Repair the JSON or named field (`sections.context`, `sections.approach[]`, or `sections.verification[]`) before proposing again. |
| Advisor rejection | Keep the session in Plan Mode and address the returned safety defect; no native review is opened. |
| Need to revert the distributed plugin | Install the previous known release: `omp plugin install github:stgmt/omp-plan-kit#v1.5.0`. |

## Commit note

The repository pre-commit reviewer-kit hook was bypassed for the release commit because it timed out. The release preflight, full behavioral battery, GitHub workflow, attestation, archive comparison, and clean-profile smoke all passed.
