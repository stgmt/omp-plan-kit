# OMP Review Kit commit review (in-session multi-stage)

- scope: commit `bde098c` (fix(validator) accept natural Russian expected token and repair hint precision), diff `d3c4cf5..bde098c`
- follow-up: commit `649243e` (fix(tests) resolve pi-ai via loadLegacyPiModule in mutation harness)
- context: this review replaces the pre-commit reviewer-kit runs that timed out on all models (see 2026-09-05T16-47-30* and 16-51-45* reports); executed in-session per skill://multi-stage-review and skill://reality-first-review
- result: BLOCK on bde098c (1 confirmed P1) -> fixed by 649243e -> PASS on the follow-up state

### Review coverage

- Stages executed: 1 context scout (review-context-scout), 2 parallel risk hunters (correctness + security lanes), 3 adversarial verification (review-finding-verifier), 4 synthesis (this report).
- Files inspected: src/plan-validator.ts, src/extension.ts, tests/e2e-plan-validator.mjs, tests/e2e-programmer.mjs, tests/e2e-validator-mutations.mjs, package.json, README.md, CHANGELOG.md, dist/extension.js (as build artifact), audit-reports/plan-validator-i18n-rejection-handoff-2026-09-05.md.
- Skills applied: multi-stage-review, reality-first-review, project rule .omp/rules/tests.md (test discipline).

### Confirmed findings

1. [P1, FIXED in 649243e] tests/e2e-validator-mutations.mjs:349-351 — bare `import(pathToFileURL(bundlePath).href)` of bundles built with `--external @oh-my-pi/pi-ai` resolved only under the author session's ambient NODE_PATH. Documented workflows (`bun tests/e2e-validator-mutations.mjs`, `npm run e2e:mutations`, `e2e:all`) crashed in a clean environment with `Error: Failed to load pi_natives native addon for win32-x64 (modern)` before any scenario ran. Verified by the adversarial stage: reproduction under the documented workflow from repo root, control pass with NODE_PATH injected, contrast with sibling suites that load via `loadLegacyPiModule`. Fix: harness now resolves through `loadLegacyPiModule` from `OMP_CODING_AGENT_ROOT`; sanitized-env rerun (NODE_PATH unset) passes with 11/11 mutants killed, survivors [].

### Unproven/rejected summary

- Security lane: zero candidates. Uncounted preflight rejections cost 0 disk reads (parseSlug) or 1 fs.stat (missing artifact); budget/latch limits intact; no untrusted plan text flows into repair packets; harness writes confined to .mutation-build and os.tmpdir with argument-array spawnSync; dist bundle verified byte-identical to a fresh build of the sources.
- Correctness lane: no further candidates survived anti-noise screening (boundary/regex/hint-consumer/mutation-honesty/test-gap angles all covered; hint exact-string consumers were updated in the same commit).

REVIEW_RESULT=PASS
