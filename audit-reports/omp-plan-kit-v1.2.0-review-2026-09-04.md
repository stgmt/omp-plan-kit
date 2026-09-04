# OMP Plan Kit v1.2.0 — Post-Release Review & Integrity Evidence

- Date: 2026-09-04
- Version: `1.2.0`
- Tag: `v1.2.0`
- Release Commit: `19b1496944ce6621ad2f62dd7e0026a59903a261`
- Target Branch: `main`
- Release Asset: `omp-plan-kit-1.2.0.tgz`
- Asset Digest: `sha256:463abab2af98cda277618f219b16ed9166a8f4bf1b25747dfa2154bd629cd881`
- Bundle (`dist/extension.js`) SHA-256: `7cccafc6647b01b7b4bbc805ec48a199f87f0e782290ab07198f1a34021a166e`
- Final Verdict: **PASS** (100% verified, reproducible, attested, and smoke-tested)

> **Lineage Statement**: Tag `v1.2.0` points directly to frozen release commit `19b1496944ce6621ad2f62dd7e0026a59903a261`. The `main` branch after merging this audit report will lead `v1.2.0` solely by this post-release review commit.

---

## 1. Facts Table

| Item | Command / Reference | Value / Output | Status |
|---|---|---|---|
| Package version | `node -p "require('./package.json').version"` | `1.2.0` | Verified |
| Release Tag | `git rev-parse v1.2.0^{commit}` | `19b1496944ce6621ad2f62dd7e0026a59903a261` | Verified |
| Pull Request (Features) | PR #2 `feat/plan-validator-convergence-v1.2.0` | Merged via rebase into `main` | Verified |
| Pull Request (Bun Pin) | PR #3 `fix/pin-bun-reproducibility` | Merged via rebase into `main` | Verified |
| Dry Run Workflow | Run ID `33899379419` (`publish=false`) | Completed in 14s; all 10 steps green | Verified |
| Official Release Workflow | Run ID `33916508733` (`publish=true`) | Completed in 24s; release created | Verified |
| GitHub Release | `gh release view v1.2.0 --json tagName,isDraft` | `tagName: "v1.2.0"`, `isDraft: false` | Verified |
| Asset Digest | `gh release view v1.2.0 --json assets` | `sha256:463abab2af98cda277618f219b16ed9166a8f4bf1b25747dfa2154bd629cd881` | Matched |
| Downloaded Asset SHA | `sha256sum omp-plan-kit-1.2.0.tgz` | `463abab2af98cda277618f219b16ed9166a8f4bf1b25747dfa2154bd629cd881` | Matched |
| GitHub Attestation | `gh attestation verify omp-plan-kit-1.2.0.tgz` | Verification succeeded; 0 errors | Verified |
| Tarball Contents | `tar -tf omp-plan-kit-1.2.0.tgz \| sort` | Exactly `package/{LICENSE,README.md,package.json,dist/extension.js}` | Verified |
| Unpacked Bundle SHA | `sha256sum package/dist/extension.js` | `7cccafc6647b01b7b4bbc805ec48a199f87f0e782290ab07198f1a34021a166e` | Matched |
| Scratch Profile Install | `omp --profile v120-release-review plugin install` | `Installed omp-plan-kit@1.2.0` | Verified |
| Installed Byte Equality | File byte comparison against repo bundle | Bit-for-bit identical (`true`) | Verified |
| Scratch Smoke Battery | 3 observable plan-mode scenarios | All 3 scenarios passed | Verified |
| Scratch Profile Cleanup | `omp --profile v120-release-review plugin uninstall` | Profile uninstalled and directory deleted | Clean |

---

## 2. Independent Code Review Findings

An independent subagent code review was conducted against the candidate git diff before freezing the tag:
- **Patch SHA-256**: `1b7f14a1907b35aed9174b63b784a30f61fb5c0fea533979172eec6556a2f8ef`
- **Agent**: `ReviewerV120`
- **Result**: `PASS` (0 blocking, 0 warnings, 0 nits, confidence: 1)

### Checklist Verification Summary

1. **All-errors repair packet completeness**: Confirmed. `validatePlanStructure` collects all independent errors (`PLAN_EMPTY`, `SECTION_MISSING`, `SECTION_DUPLICATE`, `SECTION_ORDER`, `SECTION_EMPTY`) across the full file in one pass.
2. **Dependent error suppression**: Confirmed. If a section is missing, secondary `SECTION_EMPTY` and `SECTION_ORDER` issues for that section are suppressed.
3. **Issue signature stability**: Confirmed. `issueSignature` constructs sorted `code:section` pairs, ignoring line numbers and whitespace shifts to prevent false progress on cosmetic changes.
4. **Convergence limits**: Confirmed. `MAX_FAILED_VALIDATIONS = 3`, `MAX_SAME_HASH_REPEATS = 2`, `MAX_NO_PROGRESS_ATTEMPTS = 2`, and `MAX_TURN_PROPOSALS = 4` are hardcoded, immutable constants.
5. **No `ctx.abort()` in `tool_call`**: Confirmed. `ctx.abort()` is never called in the hook, preventing OMP from overwriting diagnostic failure reasons with generic abort messages.
6. **No bypass to advisor or core dispatch**: Confirmed. Structurally invalid plans return immediately without invoking `reviewProposedPlan` or reaching OMP core dispatch.
7. **`handleAgentStart` reset**: Confirmed. Resets `turnId`, `proposalCount`, `turnState.blocked`, and `cyclesBySlug` on new prompt or native `Refine plan`.
8. **Batch tool-call race documentation**: Confirmed. Reason for `PLAN_FILE_MISSING` guides the model to separate file write and `xd://propose` across subsequent turns.
9. **Receipt redaction**: Confirmed. Receipts contain metadata (hashes, counts, codes) and redact user secrets/tokens; full plan content is never written to receipts.
10. **Sandbox & fixture cleanup**: Confirmed. All tests utilize `try ... finally` blocks to delete temporary session directories and scratch profiles.
11. **Release workflow reproducibility**: Confirmed. Bun is pinned to `1.4.1`, build reproducibility is verified with SHA-256 comparison, archive contents are asserted, and attestation is verified.

---

## 3. Behavioral and E2E Test Verification

All six test suites executed cleanly:

```text
bun tests/e2e-plan-validator.mjs          -> 15/15 tests passed
bun tests/e2e-convergence-controller.mjs  -> 7/7 tests passed
bun tests/e2e-programmer.mjs              -> all mutation cases passed, multi-profile loader verified
bun tests/e2e-advisor-contract.mjs        -> budget, bounds, cache deduplication passed (2 advisor calls)
bun tests/e2e-real-plan-handoff.mjs       -> in-process dispatchResolutionDevice passed (3 advisor calls)
bun tests/e2e-advisor-live.mjs            -> live model (openai-codex/gpt-5.6-sol) reject + approve passed
```

### 3-Scenario Scratch Profile Verification (Live OMP Loader)
In clean profile `v120-release-review`:
- **Scenario 1**: Malformed plan returned `[PLAN_VALIDATOR_BLOCK]` with three missing sections; human review overlay was NOT opened; 0 advisor tokens consumed.
- **Scenario 2**: Three consecutive attempts without changes triggered `[PLAN_VALIDATOR_STOPPED]`; fourth attempt returned `[PLAN_VALIDATOR_BLOCKED]` in $O(1)$ time with 0 advisor calls.
- **Scenario 3**: Native `Refine plan` reset the budget; corrected valid plan passed the validator, received advisor approval, and successfully opened the OMP review overlay (`local://clean-plan.md`).

---

## 4. Defect List

- Known blocking defects: **0**
- Known non-blocking defects: **0**

---

## 5. Failure Mode Matrix

| Failure Mode | Detection Mechanism | Observable Output | Token Cost |
|---|---|---|---|
| Empty plan file | `validatePlanStructure` check | `[PLAN_VALIDATOR_BLOCK] ... PLAN_EMPTY` | 0 tokens |
| Missing required section | Header scan outside code fences | `[PLAN_VALIDATOR_BLOCK] ... SECTION_MISSING` | 0 tokens |
| Out-of-order section | Position comparison against canonical rank | `[PLAN_VALIDATOR_BLOCK] ... SECTION_ORDER` | 0 tokens |
| Empty section body | Line content scan between headings | `[PLAN_VALIDATOR_BLOCK] ... SECTION_EMPTY` | 0 tokens |
| Duplicate section header | Multi-occurrence scan | `[PLAN_VALIDATOR_BLOCK] ... SECTION_DUPLICATE` | 0 tokens |
| Unchanged invalid plan repeat | `sha256 === cycle.lastSha256` | `[PLAN_VALIDATOR_BLOCK] Plan file is unchanged` | 0 tokens |
| Repeated unchanged cutoff | `sameHashCount >= 2` | `[PLAN_VALIDATOR_STOPPED]` | 0 tokens |
| No-progress hash churn | `issues.length >= prevCount` | `[PLAN_VALIDATOR_STOPPED]` (after 2 iterations) | 0 tokens |
| Turn proposal budget exceeded | `turn.proposalCount > 4` | `[PLAN_VALIDATOR_TURN_BLOCKED]` | 0 tokens |
| Validator internal exception | `try ... catch (err)` | `[PLAN_VALIDATOR_INTERNAL_ERROR]` (fail-closed) | 0 tokens |
| Advisor model rejection | LLM review critique | `[PLAN_ADVISOR_BLOCK] Советник отклонил план: ...` | Max 160 tokens |

---

## 6. Rollback Procedure

If unexpected regressions occur with `v1.2.0`:

```bash
omp plugin uninstall omp-plan-kit
omp plugin install github:stgmt/omp-plan-kit#v1.1.0
```

Release tag `v1.2.0` is immutable on GitHub and must never be deleted or force-pushed. Any necessary remediations will be published as patch release `v1.2.1`.
