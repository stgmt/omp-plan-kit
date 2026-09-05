# OMP Plan Kit v1.4.0 release integrity review (2026-09-05)

Scope: tag `v1.4.0`, GitHub Release `v1.4.0`, published asset `omp-plan-kit-1.4.0.tgz`.

## Facts table

| # | Fact | Evidence |
|---|---|---|
| 1 | Tag binding: `HEAD == v1.4.0^{commit} == origin/main` at `d4f4e82fd9f1...` | `git rev-parse HEAD "v1.4.0^{commit}" origin/main` -> identical |
| 2 | Deterministic build; committed dist equals fresh build | `bun run build` double-run SHA equal; `git diff HEAD -- dist` empty |
| 3 | Release workflow green: reproducibility, `npm run check`, pack, attestation, publish | `gh run watch 33985615062 --exit-status` -> RUN-SUCCESS |
| 4 | Release not draft/prerelease, target `main`, asset `omp-plan-kit-1.4.0.tgz` with sha256 digest | `gh release view v1.4.0 --json` |
| 5 | Downloaded asset digest matches published digest | `gh release download` + sha256 -> equal |
| 6 | Attestation verified (`stgmt/omp-plan-kit`) | `gh attestation verify` -> RC 0 |
| 7 | Body authored from repo notes file; no local paths | `gh release view --json body` |
| 8 | Published dist byte-identical to committed dist | extracted from tgz, sha256 equal |
| 9 | Clean-profile install from tag: `Installed omp-plan-kit@1.4.0`; installed dist == committed dist | real CLI install + byte compare |
| 10 | Real-loader behavior: label `OMP Plan Kit`, 1 handler, 0 loader errors; malformed blocked (`NON_SLUG_PAYLOAD`); plan with German result line (`Erwartet: alles grün`) passes end-to-end | `bun` probe through `loadExtensions` |
| 11 | Scratch profile uninstalled and removed | directory absent |

## Known environmental note (not a release defect)

`tests/e2e-real-plan-handoff.mjs` currently needs `NODE_PATH=C:/Users/stigm/.omp/plugins/node_modules` on this machine: the bun global cache fails to load `pi_natives` for the pi-coding-agent source chain. Reproduced identically on a pristine `v1.3.1` worktree (pre-existing machine state, not introduced by this release). All other suites run without it.

## Failure modes and rollback

| Failure mode | Mitigation |
|---|---|
| Language whitelist regression reintroduced | Mutants `M-restore-token-requirement`, `M-allow-heading-as-result`, `M-ignore-block-content` are killed by the mutation suite |
| Budget regression | Programmer e2e budget block + `B-budget-counts-preflight-passed-only` scenario |
| Bad published asset | digest + attestation checks gate; reinstall from source tag |
| Rollback | `omp plugin install github:stgmt/omp-plan-kit#v1.3.1` |
