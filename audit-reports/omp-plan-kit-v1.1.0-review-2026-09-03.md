# OMP Plan Kit v1.1.0 — release integrity review

Date: 2026-09-03

## Verdict

**PASS with one fixed defect.**

The release candidate and published release are internally consistent: the tag pins the verified
build, the GitHub release carries the same artifact bytes, the published package loads through
OMP's real loader in a clean named profile, and all four E2E suites pass. One defect found during
review — a corrupted release body that leaked a local session path — was fixed before publish
finalized and is documented below.

## Artifact freeze

- Commit: `644cdefac3c3354687f009da4c2e644b4a8dfd0d` (main = origin/main = tag target).
- Tag: `v1.1.0` (annotated; `^{}` resolves to `644cdef`).
- Release: https://github.com/stgmt/omp-plan-kit/releases/tag/v1.1.0
- Asset: `omp-plan-kit-1.1.0.tgz`
- Asset SHA-256: `17b58849ef71b3c158f4d24a0d0c9e4956377bd7911363f8b7a4c7cb643240ba`

## Facts table

| Claim | Evidence | Verdict |
|---|---|---|
| `package.json` version = `1.1.0`, `omp.extensions` = `./dist/extension.js` | `git show v1.1.0:package.json` | PASS |
| Monorepo-independent single extension entrypoint | tag tree `dist/extension.js` present | PASS |
| Deterministic build: source → `dist/extension.js` reproduces committed bytes | `bun run build` twice → SHA-256 `0cec38c3…` both times | PASS |
| Committed `dist/extension.js` == rebuild output | SHA-256 equality `0cec38c3…` | PASS |
| Released tgz contains `package/{LICENSE,README.md,package.json,dist/extension.js}` | `npm pack` listing | PASS |
| Published asset digest matches local tarball | `sha256sum omp-plan-kit-1.1.0.tgz` = `17b58849…` = GitHub asset digest | PASS |
| GitHub-tag install resolves and installs `omp-plan-kit@1.1.0` | `omp --profile v1100-review plugin install github:stgmt/omp-plan-kit#v1.1.0` → `✔ Installed omp-plan-kit@1.1.0` | PASS |
| Installed package byte-identical to committed dist | installed `dist/extension.js` SHA-256 `0cec38c3…` | PASS |
| Installed package loads through OMP real loader | scratch-profile `loadExtensions` proof → label `OMP Plan Kit`, guard blocks `NON_SLUG_PAYLOAD`, clean slug passes, todo passes | PASS |
| Release not draft/prerelease, target `main` | `gh release view v1.1.0` | PASS |
| E2E suites green | `e2e-programmer`, `e2e-advisor-contract`, `e2e-real-plan-handoff`, `e2e-advisor-live` (live on `openai-codex/gpt-5.6-sol`) | PASS |

## Defect found and fixed

- **Defect**: the initial release body contained a corrupted fragment where the intended
  `local://<slug>-plan.md` placeholder was replaced by a literal absolute session path
  (`C:\Users\stigm\.omp\agent\sessions\…\local<slug>-plan.md`), leaking a local path into a
  public release note.
- **Fix**: release body replaced from `audit-reports/v1.1.0-release-notes.md` (pinned to the
  review); verified via `gh release view v1.1.0 --json body` that no session path remains.
- **Guard against recurrence**: future release notes MUST be authored in a repo file and passed
  via `gh release edit --notes-file`, never through a shell heredoc that the environment
  re-interprets.

## Failure-mode table

| Failure mode | Explored | Outcome |
|---|---|---|
| Tag points to wrong commit | `git rev-parse v1.1.0^{}` vs HEAD/origin/main | identical `644cdef` — PASS |
| Asset drift (uploaded ≠ built) | digest comparison | PASS |
| Published package fails to load in clean profile | scratch-profile loader proof | PASS |
| Collateral `node_modules` in release package | `npm pack` file list | excluded via `files` — PASS |
| Release-body template injection | reviewed body text after fix | PASS |

## Scope of this review

- Not re-reviewed: the advisor model prompt quality (covered by `plan-advisor-exit-gate-2026-09-03.md`).
- Not evaluated: marketplace publishing (this release is GitHub-tag + asset install, no npm registry).

## Rollback

- Rollback path: `omp plugin uninstall omp-plan-kit` per OMP plugin lifecycle, then reinstall
  `github:stgmt/omp-plan-kit#v1.0.1` if needed. The tag and commit remain immutable on GitHub.