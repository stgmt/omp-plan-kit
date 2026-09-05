# OMP Plan Kit v1.5.0 release integrity review (2026-09-05)

Scope: tag `v1.5.0`, GitHub Release `v1.5.0`, published asset `omp-plan-kit-1.5.0.tgz`.

## Facts table

| # | Fact | Evidence |
|---|---|---|
| 1 | Tag binding: `HEAD == v1.5.0^{commit} == origin/main` at `1ffb3e1aab82...` | `git rev-parse HEAD "v1.5.0^{commit}" origin/main` -> identical |
| 2 | Deterministic build; committed dist equals fresh build | double `bun run build` SHA equal; pack contents exactly `package/{LICENSE,README.md,package.json,dist/extension.js}` |
| 3 | Release workflow green | `gh run watch 33987371406 --exit-status` -> RUN-SUCCESS |
| 4 | Release not draft/prerelease, target `main`; asset `omp-plan-kit-1.5.0.tgz` with sha256 digest `60f614005a251de1...` | `gh release view v1.5.0 --json` |
| 5 | Downloaded asset digest matches published digest | `gh release download` + sha256 -> equal |
| 6 | Attestation verified | `gh attestation verify ... --repo stgmt/omp-plan-kit` -> RC 0 |
| 7 | Body authored from repo notes file `audit-reports/v1.5.0-release-notes.md`; no local paths | `gh release view --json body` |
| 8 | Published dist byte-identical to committed dist | extracted from tgz, sha256 equal |
| 9 | Clean-profile install from tag: `Installed omp-plan-kit@1.5.0`; installed dist byte-equal | real CLI install + byte compare |
| 10 | Real-loader behavior: label `OMP Plan Kit`, 1 handler, 0 loader errors; malformed blocked (`NON_SLUG_PAYLOAD`); a plan with a fully Russian JSON core and Russian headings passes end-to-end through the installed build | `bun` probe through `loadExtensions` |
| 11 | Scratch profile uninstalled and removed | directory absent |

## Behavior shipped in this release

- Optional JSON plan core (`--- { sections: { context, approach[], verification[] } } ---`): valid core short-circuits Markdown parsing; `PLAN_CORE_INVALID` fails closed with the exact violated field; unclosed leading `---` falls back to Markdown; unknown keys ignored.
- Design basis: `audit-reports/research-competitor-plan-validation-2026-09-05.md` (validation-by-construction; Gherkin registry and LLM extraction evaluated and rejected).

## Known environmental note (unchanged, not a release defect)

`tests/e2e-real-plan-handoff.mjs` needs `NODE_PATH=C:/Users/stigm/.omp/plugins/node_modules` on this machine (bun cache cannot load `pi_natives` for the pi-coding-agent chain). Reproduces on pristine v1.3.1/v1.4.0 worktrees; all other suites run without it.

## Failure modes and rollback

| Failure mode | Mitigation |
|---|---|
| Core path skipped or weakened | Mutants `M-drop-core-path`, `M-core-lenient-context`, `M-core-skip-expects` killed by mutation suite |
| Invalid JSON silently parsed as Markdown | Fail-closed `PLAN_CORE_INVALID` covered by e2e case 17 and `V-core-broken-json` |
| Budget regression | Programmer e2e budget block + `B-budget-counts-preflight-passed-only` |
| Rollback | `omp plugin install github:stgmt/omp-plan-kit#v1.4.0` |
