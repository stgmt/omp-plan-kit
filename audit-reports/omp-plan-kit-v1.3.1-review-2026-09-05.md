# OMP Plan Kit v1.3.1 release integrity review (2026-09-05)

Scope: tag `v1.3.1`, GitHub Release `v1.3.1`, published asset `omp-plan-kit-1.3.1.tgz`.

## Facts table

| # | Fact | Evidence |
|---|---|---|
| 1 | Tag-to-commit binding: `HEAD == v1.3.1^{commit} == origin/main` at `17734e8e4650890b0f25d9ea0e8b9a395aeea6c2` | `git rev-parse HEAD "v1.3.1^{commit}" origin/main` -> three identical hashes |
| 2 | Deterministic build: committed `dist/extension.js` equals fresh `bun run build` | `git diff --stat HEAD -- dist` empty; double-rebuild SHA-256 equal (`d0101ac2378b2da3...`) |
| 3 | Local pack contents exactly `package/{LICENSE,README.md,package.json,dist/extension.js}` | `npm pack` + tar listing (local tarball deleted after check) |
| 4 | Release workflow green: build reproducibility, `npm run check`, pack, attestation, publish | `gh run watch 33982055921 --exit-status` -> RUN-SUCCESS; run id 33982055921 |
| 5 | Release state: not draft, not prerelease, target `main` | `gh release view v1.3.1 --json` |
| 6 | Single asset `omp-plan-kit-1.3.1.tgz` with digest `sha256:6fd3edf7f6150db5d585368d660929988252b2e72ffe9b7f56c4d46ba388f645` | `gh release view --json assets` |
| 7 | Downloaded asset digest matches published digest | `gh release download` + local sha256 -> equal |
| 8 | Attestation verified against `stgmt/omp-plan-kit` | `gh attestation verify download-check/omp-plan-kit-1.3.1.tgz --repo stgmt/omp-plan-kit` -> RC 0 |
| 9 | Release body clean: authored from repo file `audit-reports/v1.3.1-release-notes.md` (notes-file hygiene), 3801 chars, no local paths (`C:\Users`, `local://`, `.omp` absent) | `gh release view --json body` |
| 10 | Published dist byte-identical to committed dist | extracted `package/dist/extension.js` from published tgz == repo `dist/extension.js` (sha256) |
| 11 | Clean-profile install proof: `omp --profile release-e2e-v131 plugin install github:stgmt/omp-plan-kit#v1.3.1` -> `Installed omp-plan-kit@1.3.1`; installed `dist/extension.js` byte-equal to published archive | real CLI install + byte compare |
| 12 | Real-loader behavior of installed build: `loadExtensions` 0 errors, label `OMP Plan Kit`, 1 `tool_call` handler; malformed `xd://propose` payload blocked with `NON_SLUG_PAYLOAD`; valid slug with exact artifact passes (advisor disabled env); unrelated `write` untouched | `bun` probe through `loadExtensions` (`loader.ts`) |
| 13 | Negative-path honesty: invalid plan fixture (`#` headings) was rejected by the installed build before the positive case passed with a valid fixture | observed during step 12 |
| 14 | Scratch profile removed after proof: uninstall + `rm -rf ~/.omp/profiles/release-e2e-v131` | directory absent |

## Defects found during release

None. (Pre-release defects were already fixed in `649243e` per the in-session review report.)

## Failure modes and rollback

| Failure mode | Mitigation |
|---|---|
| Regression in Russian token acceptance | Mutation suite kills token-alternation mutants (`M-drop-ozhidaetsya`, `M-drop-ozhidaemo`, `M-drop-expected`) |
| Budget regression (malformed burning budget / off-by-one / lost latch) | `B-budget-counts-preflight-passed-only` scenario + programmer e2e budget block kill `M-budget-counts-malformed`, `M-budget-off-by-one`, `M-budget-no-latch` |
| Bad published asset | Attestation + digest verification gate; reinstall from GitHub source tag: `omp plugin install github:stgmt/omp-plan-kit#v1.3.1` |
| Need rollback | `omp plugin install github:stgmt/omp-plan-kit#v1.3.0` (v1.3.0 release remains published) |

## Notes

- Notes-file hygiene honored: body authored in `audit-reports/v1.3.1-release-notes.md`, passed via workflow `--notes-file`, verified post-publish.
- npm is not used for distribution; the npm registry is out of scope for this repository.
