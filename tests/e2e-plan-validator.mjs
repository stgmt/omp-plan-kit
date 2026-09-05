import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const home = os.homedir();
const installedExtension = process.env.OMP_PLAN_KIT_EXTENSION_PATH
  ? path.resolve(process.env.OMP_PLAN_KIT_EXTENSION_PATH)
  : path.join(process.cwd(), "dist", "extension.js");
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadLegacyPiModule } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/plugins/legacy-pi-compat.ts")).href);

const extensionModule = await loadLegacyPiModule(installedExtension);
const {
  validatePlanStructure,
  issueSignature,
  formatRepairPacket,
  createPlanProtectionForTest,
} = extensionModule;

assert.equal(typeof validatePlanStructure, "function", "validatePlanStructure must be exported");
assert.equal(typeof issueSignature, "function", "issueSignature must be exported");
assert.equal(typeof formatRepairPacket, "function", "formatRepairPacket must be exported");
assert.equal(typeof createPlanProtectionForTest, "function", "createPlanProtectionForTest must be exported");

// =========================================================================
// Unit tests: validatePlanStructure
// =========================================================================

// 1. Empty plan
{
  const issues = validatePlanStructure("");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "PLAN_EMPTY");
  assert.equal(issues[0].line, 1);

  const whitespaceIssues = validatePlanStructure("   \r\n  \n  ");
  assert.equal(whitespaceIssues.length, 1);
  assert.equal(whitespaceIssues[0].code, "PLAN_EMPTY");
}

// 2. All three required sections missing in one packet
{
  const markdown = "# Title Only\n\nSome body text without any h2 sections.\n";
  const issues = validatePlanStructure(markdown);
  assert.equal(issues.length, 3, "Must return exactly 3 independent missing section errors in one packet");
  const codes = issues.map((i) => `${i.code}:${i.section}`);
  assert.deepEqual(codes, [
    "SECTION_MISSING:Approach",
    "SECTION_MISSING:Context",
    "SECTION_MISSING:Verification",
  ]);
}

// 3. Duplicate sections with exact lines
{
  const markdown = [
    "## Context", // 1
    "Context 1", // 2
    "## Approach", // 3
    "Approach 1", // 4
    "## Verification", // 5
    "Verification 1", // 6
    "## Context", // 7 (duplicate)
    "Context 2", // 8
    "## Verification", // 9 (duplicate)
    "Verification 2", // 10
  ].join("\n");

  const issues = validatePlanStructure(markdown);
  const duplicates = issues.filter((i) => i.code === "SECTION_DUPLICATE");
  assert.equal(duplicates.length, 2, "Must report every extra duplicate line");
  assert.equal(duplicates[0].section, "Context");
  assert.equal(duplicates[0].line, 7);
  assert.equal(duplicates[1].section, "Verification");
  assert.equal(duplicates[1].line, 9);
}

// 4. Section order violations with exact lines
{
  // Approach after Verification
  const outOfOrder1 = [
    "## Context", // 1
    "Context text", // 2
    "## Verification", // 3
    "Verification text", // 4
    "## Approach", // 5 (out of order!)
    "Approach text", // 6
  ].join("\n");

  const issues1 = validatePlanStructure(outOfOrder1);
  const orderIssues1 = issues1.filter((i) => i.code === "SECTION_ORDER");
  assert.equal(orderIssues1.length, 1);
  assert.equal(orderIssues1[0].section, "Approach");
  assert.equal(orderIssues1[0].line, 5);

  // Critical files & anchors before Approach
  const outOfOrder2 = [
    "## Context", // 1
    "Context text", // 2
    "## Critical files & anchors", // 3 (out of order!)
    "Anchors text", // 4
    "## Approach", // 5
    "Approach text", // 6
    "## Verification", // 7
    "Verification text", // 8
  ].join("\n");

  const issues2 = validatePlanStructure(outOfOrder2);
  const orderIssues2 = issues2.filter((i) => i.code === "SECTION_ORDER");
  assert.equal(orderIssues2.length, 1);
  assert.equal(orderIssues2[0].section, "Critical files & anchors");
  assert.equal(orderIssues2[0].line, 3);

  // Assumptions & contingencies before Verification
  const outOfOrder3 = [
    "## Context", // 1
    "Context text", // 2
    "## Approach", // 3
    "Approach text", // 4
    "## Assumptions & contingencies", // 5 (out of order!)
    "Assumptions text", // 6
    "## Verification", // 7
    "Verification text", // 8
  ].join("\n");

  const issues3 = validatePlanStructure(outOfOrder3);
  const orderIssues3 = issues3.filter((i) => i.code === "SECTION_ORDER");
  assert.equal(orderIssues3.length, 1);
  assert.equal(orderIssues3[0].section, "Assumptions & contingencies");
  assert.equal(orderIssues3[0].line, 5);
}

// 5. Section empty with exact line
{
  const emptySectionMarkdown = [
    "## Context", // 1 (empty!)
    "", // 2
    "   ", // 3
    "## Approach", // 4
    "Approach details in `src/file.ts`", // 5
    "## Verification", // 6
    "`bun test` → exit code 0", // 7
  ].join("\n");

  const issues = validatePlanStructure(emptySectionMarkdown);
  const emptyIssues = issues.filter((i) => i.code === "SECTION_EMPTY");
  assert.equal(emptyIssues.length, 1);
  assert.equal(emptyIssues[0].section, "Context");
  assert.equal(emptyIssues[0].line, 1);
}

// 6. Suppression of dependent errors (missing section does not trigger SECTION_EMPTY, SECTION_ORDER, APPROACH_TARGET_MISSING, or VERIFICATION_NOT_ACTIONABLE)
{
  const missingOnly = [
    "## Verification", // 1
    "- `bun test` → exit code 0", // 2
  ].join("\n");

  const issues = validatePlanStructure(missingOnly);
  // Context and Approach are missing
  const missingCodes = issues.filter((i) => i.code === "SECTION_MISSING");
  assert.equal(missingCodes.length, 2);
  // No SECTION_EMPTY, SECTION_ORDER, or APPROACH_TARGET_MISSING for missing Context or Approach
  const contextIssues = issues.filter((i) => i.section === "Context");
  assert.equal(contextIssues.length, 1);
  assert.equal(contextIssues[0].code, "SECTION_MISSING");

  const approachIssues = issues.filter((i) => i.section === "Approach");
  assert.equal(approachIssues.length, 1);
  assert.equal(approachIssues[0].code, "SECTION_MISSING");

  // Verification is valid, so no VERIFICATION_NOT_ACTIONABLE
  const verifIssues = issues.filter((i) => i.section === "Verification");
  assert.equal(verifIssues.length, 0);
}

// 7. Code fence containing ## headings inside must be ignored as headings
{
  const fencedMarkdown = [
    "## Context",
    "Context description",
    "```markdown",
    "## Approach", // Inside fence: NOT a heading!
    "Fenced text",
    "```",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");

  const issues = validatePlanStructure(fencedMarkdown);
  // Approach outside fence is missing!
  const approachMissing = issues.find((i) => i.code === "SECTION_MISSING" && i.section === "Approach");
  assert.ok(approachMissing, "Heading inside code fence must not satisfy required Approach section");
}

// 8. Fully valid minimal plan
{
  const validMinimal = [
    "## Context",
    "Context description and background.",
    "## Approach",
    "1. `src/plan-validator.ts#validatePlanStructure` implementation",
    "2. `GET /api/orders` route handler",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");

  const issues = validatePlanStructure(validMinimal);
  assert.equal(issues.length, 0, "Valid minimal plan must have 0 issues");
}

// 9. Fully valid plan with optional sections
{
  const validFull = [
    "## Context",
    "Context description.",
    "## Approach",
    "Implementation plan for `src/plan-validator.ts`.",
    "## Critical files & anchors",
    "- src/index.ts: main entry",
    "## Verification",
    "```bash",
    "bun test",
    "```",
    "Expected: all tests pass",
    "## Assumptions & contingencies",
    "Contingency plan here.",
  ].join("\n");

  const issues = validatePlanStructure(validFull);
  assert.equal(issues.length, 0, "Valid full plan must have 0 issues");
}

// 10. APPROACH_TARGET_MISSING negative cases
{
  // A. Section without steps (entire section is 1 step)
  const singleStepNoTarget = [
    "## Context", // 1
    "Context text.", // 2
    "## Approach", // 3
    "Update the validator.", // 4
    "## Verification", // 5
    "`bun test` → exit code 0", // 6
  ].join("\n");
  const issuesA = validatePlanStructure(singleStepNoTarget);
  const targetIssuesA = issuesA.filter((i) => i.code === "APPROACH_TARGET_MISSING");
  assert.equal(targetIssuesA.length, 1);
  assert.equal(targetIssuesA[0].line, 3, "Line must be the Approach heading line for single-step section");
  assert.equal(targetIssuesA[0].message, "Approach step at line 3 has no exact target");
  assert.match(targetIssuesA[0].fix, /src\/file\.ts#symbol/);
  assert.match(targetIssuesA[0].fix, /GET \/api\/orders/);
  assert.match(targetIssuesA[0].fix, /Settings > Billing/);

  // B. H3 steps
  const h3Steps = [
    "## Context", // 1
    "Context text.", // 2
    "## Approach", // 3
    "### 1. Update the validator", // 4 (missing target)
    "Some detail text.", // 5
    "### 2. Refine `src/plan-validator.ts#validatePlanStructure`", // 6 (has target)
    "Detail with target.", // 7
    "### 3. Handle edge cases", // 8 (missing target)
    "More text.", // 9
    "## Verification", // 10
    "`bun test` → exit code 0", // 11
  ].join("\n");
  const issuesB = validatePlanStructure(h3Steps);
  const targetIssuesB = issuesB.filter((i) => i.code === "APPROACH_TARGET_MISSING");
  assert.equal(targetIssuesB.length, 2);
  assert.equal(targetIssuesB[0].line, 4);
  assert.equal(targetIssuesB[0].message, "Approach step at line 4 has no exact target");
  assert.equal(targetIssuesB[1].line, 8);
  assert.equal(targetIssuesB[1].message, "Approach step at line 8 has no exact target");

  // C. Numbered steps (1. or 1))
  const numSteps = [
    "## Context", // 1
    "Context text.", // 2
    "## Approach", // 3
    "1. Update the validator", // 4 (missing target)
    "2) Refine `src/plan-validator.ts`", // 5 (has target)
    "3. Add more tests", // 6 (missing target)
    "## Verification", // 7
    "`bun test` → exit code 0", // 8
  ].join("\n");
  const issuesC = validatePlanStructure(numSteps);
  const targetIssuesC = issuesC.filter((i) => i.code === "APPROACH_TARGET_MISSING");
  assert.equal(targetIssuesC.length, 2);
  assert.equal(targetIssuesC[0].line, 4);
  assert.equal(targetIssuesC[0].message, "Approach step at line 4 has no exact target");
  assert.equal(targetIssuesC[1].line, 6);
  assert.equal(targetIssuesC[1].message, "Approach step at line 6 has no exact target");
}

// 11. VERIFICATION_NOT_ACTIONABLE negative cases
{
  // A. Bare text without action/arrow
  const bareVerif = [
    "## Context",
    "Context.",
    "## Approach",
    "1. `src/validator.ts` update",
    "## Verification",
    "Run tests.",
  ].join("\n");
  const issuesA = validatePlanStructure(bareVerif);
  const verifIssuesA = issuesA.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE");
  assert.equal(verifIssuesA.length, 1);
  assert.equal(verifIssuesA[0].line, 5);
  assert.equal(verifIssuesA[0].message, "Verification has no actionable proof");
  assert.equal(
    verifIssuesA[0].fix,
    "Add <command or exact surface> → <observable expected result>, or a fenced command followed by `Expected:` / `Ожидается:` / `Ожидаемо:` <observable result>."
  );

  // B. Command without arrow or result
  const noArrow = [
    "## Context",
    "Context.",
    "## Approach",
    "1. `src/validator.ts` update",
    "## Verification",
    "`npm test`",
  ].join("\n");
  const issuesB = validatePlanStructure(noArrow);
  assert.equal(issuesB.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 1);

  // C. Arrow without expected result
  const arrowNoResult = [
    "## Context",
    "Context.",
    "## Approach",
    "1. `src/validator.ts` update",
    "## Verification",
    "`npm test` →   ",
  ].join("\n");
  const issuesC = validatePlanStructure(arrowNoResult);
  assert.equal(issuesC.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 1);

  // D. Fenced code block without Expected:
  const fencedNoExpected = [
    "## Context",
    "Context.",
    "## Approach",
    "1. `src/validator.ts` update",
    "## Verification",
    "```bash",
    "bun test",
    "```",
    "Check the output manually.",
  ].join("\n");
  const issuesD = validatePlanStructure(fencedNoExpected);
  assert.equal(issuesD.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 1);

  // E. Empty fenced code block with Expected:
  const emptyFenced = [
    "## Context",
    "Context.",
    "## Approach",
    "1. `src/validator.ts` update",
    "## Verification",
    "```bash",
    "```",
    "Expected: all pass",
  ].join("\n");
  const issuesE = validatePlanStructure(emptyFenced);
  assert.equal(issuesE.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 1);
}

// 12. Combined non-actionable plan returns all errors in one packet
{
  const nonActionablePlan = [
    "# Non-Actionable Plan", // 1
    "## Context", // 2
    "Add new feature.", // 3
    "## Approach", // 4
    "Update the validator.", // 5 (no target)
    "## Verification", // 6
    "Run tests.", // 7 (no actionable proof)
  ].join("\n");

  const issues = validatePlanStructure(nonActionablePlan);
  assert.equal(issues.length, 2, "Must return both APPROACH_TARGET_MISSING and VERIFICATION_NOT_ACTIONABLE in one packet");
  const codes = issues.map((i) => i.code);
  assert.deepEqual(codes, ["APPROACH_TARGET_MISSING", "VERIFICATION_NOT_ACTIONABLE"]);
  assert.equal(issues[0].line, 4);
  assert.equal(issues[1].line, 6);

  const packet = formatRepairPacket("non-actionable", issues, 1, 3);
  assert.match(packet, /1\. \[APPROACH_TARGET_MISSING\] Approach, line 4/);
  assert.match(packet, /2\. \[VERIFICATION_NOT_ACTIONABLE\] Verification, line 6/);
}

// 13. UI-only plan without CLI passes validator
{
  const uiPlan = [
    "## Context",
    "Configure billing preferences.",
    "## Approach",
    "1. Navigate to `Settings > Billing`.",
    "2. Update billing email address in `Settings > Billing > Email`.",
    "## Verification",
    "- `Settings > Billing` → confirmation is visible",
  ].join("\n");

  const issues = validatePlanStructure(uiPlan);
  assert.equal(issues.length, 0, "UI plan with Settings > Billing and confirmation arrow must pass validator with 0 issues");
}

// 14. Cyrillic Expected: format passes validator
{
  const cyrillicPlan = [
    "## Context",
    "Контекст фичи.",
    "## Approach",
    "1. Обновить `src/plan-validator.ts`.",
    "## Verification",
    "```bash",
    "bun test",
    "```",
    "Ожидаемо: все 15 тестов пройдены успешно",
  ].join("\n");

  const issues = validatePlanStructure(cyrillicPlan);
  assert.equal(issues.length, 0, "Fenced block with Cyrillic 'Ожидаемо:' must pass validator");
}

// 14b. BDD: Given a plan with a fenced command and natural Russian 'Ожидается:' When validated Then it passes; bullet form also passes
{
  const cyrillicPlan2 = [
    "## Context",
    "Контекст фичи.",
    "## Approach",
    "1. Обновить `src/plan-validator.ts`.",
    "## Verification",
    "```bash",
    "bun test",
    "```",
    "Ожидается: все 15 тестов пройдены успешно",
  ].join("\n");

  const issues2 = validatePlanStructure(cyrillicPlan2);
  assert.equal(issues2.length, 0, "Fenced block with natural Russian 'Ожидается:' must pass validator");

  const bulleted = cyrillicPlan2.replace(
    "Ожидается: все 15 тестов пройдены успешно",
    "- Ожидается: все 15 тестов пройдены успешно"
  );
  assert.equal(
    validatePlanStructure(bulleted).length, 0,
    "Bulleted 'Ожидается:' must pass validator"
  );
}

// 14c. BDD: Given a plan without Context When validated Then SECTION_MISSING fix names the exact heading literal requirement
{
  const issues = validatePlanStructure("# Title Only\n");
  const missing = issues.find((i) => i.code === "SECTION_MISSING" && i.section === "Context");
  assert.ok(missing, "Context must be reported missing");
  assert.match(
    missing.fix,
    /exactly "## Context"/,
    "SECTION_MISSING fix must state the exact heading literal"
  );
  assert.match(
    missing.fix,
    /English literal/,
    "SECTION_MISSING fix must warn that the heading line must be the English literal"
  );
}

// 14d. BDD: Given bilingual translated headings When validated Then every section is missing and no false verification error is raised
{
  const bilingual = [
    "## Context / Контекст",
    "Контекст.",
    "## Approach / Подход",
    "1. Обновить `src/plan-validator.ts`.",
    "## Verification / Проверка",
    "```sh",
    "npm test",
    "```",
    "Ожидается: всё зелёное",
  ].join("\n");
  const issues = validatePlanStructure(bilingual);
  assert.equal(issues.filter((i) => i.code === "SECTION_MISSING").length, 3);
  assert.equal(issues.filter((i) => i.code === "VERIFICATION_NOT_ACTIONABLE").length, 0);
}

// 14e. BDD: Given a fenced command without any expected-result line When validated Then the fix names all accepted tokens
{
  const noProof = [
    "## Context",
    "Контекст.",
    "## Approach",
    "1. Обновить `src/plan-validator.ts`.",
    "## Verification",
    "```sh",
    "npm test",
    "```",
  ].join("\n");
  const issues = validatePlanStructure(noProof);
  const verif = issues.find((i) => i.code === "VERIFICATION_NOT_ACTIONABLE");
  assert.ok(verif, "verification without proof must be reported");
  assert.match(verif.fix, /`Expected:` \/ `Ожидается:` \/ `Ожидаемо:`/);
}

// 15. Suppression of target/actionable errors when Approach or Verification is duplicate or empty
{
  const duplicateApproach = [
    "## Context",
    "Context.",
    "## Approach",
    "Update validator.",
    "## Approach",
    "Update again.",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");

  const issuesDup = validatePlanStructure(duplicateApproach);
  // Duplicate emitted, but APPROACH_TARGET_MISSING suppressed
  assert.equal(issuesDup.filter((i) => i.code === "SECTION_DUPLICATE").length, 1);
  assert.equal(issuesDup.filter((i) => i.code === "APPROACH_TARGET_MISSING").length, 0);

  const emptyApproach = [
    "## Context",
    "Context.",
    "## Approach",
    "",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");

  const issuesEmpty = validatePlanStructure(emptyApproach);
  assert.equal(issuesEmpty.filter((i) => i.code === "SECTION_EMPTY").length, 1);
  assert.equal(issuesEmpty.filter((i) => i.code === "APPROACH_TARGET_MISSING").length, 0);
}

// 16. issueSignature stability across whitespace and line shifts
{
  const issues1 = validatePlanStructure([
    "## Context",
    "Context 1",
    "## Approach",
    "Update the validator", // APPROACH_TARGET_MISSING at line 3
    "## Verification",
    "Run tests", // VERIFICATION_NOT_ACTIONABLE at line 5
  ].join("\n"));

  const issues2 = validatePlanStructure([
    "## Context",
    "Context 1",
    "",
    "",
    "## Approach",
    "Update the validator", // line shifted to line 5
    "",
    "",
    "## Verification",
    "Run tests", // line shifted to line 9
  ].join("\n"));

  assert.notEqual(issues1[0].line, issues2[0].line);
  assert.notEqual(issues1[1].line, issues2[1].line);
  assert.equal(issueSignature(issues1), issueSignature(issues2), "New issue codes must maintain stable issueSignature across cosmetic line shifts");
  assert.equal(
    issueSignature(issues1),
    "APPROACH_TARGET_MISSING:Approach;VERIFICATION_NOT_ACTIONABLE:Verification"
  );
}

// 17. formatRepairPacket
{
  const issues = [
    { code: "SECTION_MISSING", section: "Context", message: 'Required section "Context" is missing', fix: 'Add "## Context" section.' },
    { code: "SECTION_ORDER", section: "Approach", line: 12, message: 'Section "Approach" is out of order', fix: 'Move "## Approach" before "## Verification".' },
  ];
  const packet = formatRepairPacket("my-feature", issues, 1, 3);
  assert.ok(packet.startsWith("[PLAN_VALIDATOR_BLOCK]"), "Must start with [PLAN_VALIDATOR_BLOCK]");
  assert.match(packet, /Attempt 1 of 3/);
  assert.match(packet, /1\. \[SECTION_MISSING\] Context: Required section "Context" is missing\. Fix: Add "## Context" section\./);
  assert.match(packet, /2\. \[SECTION_ORDER\] Approach, line 12: Section "Approach" is out of order\. Fix: Move "## Approach" before "## Verification"\./);
  assert.match(packet, /Fix every issue above in local:\/\/my-feature-plan\.md, keep the same slug, reread the complete plan, and do not call xd:\/\/propose until all listed issues are fixed\./);
}

// =========================================================================
// Integration tests: handleToolCall with real extension loader
// =========================================================================

const sessionId = `validator-e2e-${process.pid}-${Date.now()}`;
const localRoot = path.join(os.tmpdir(), "omp-local", sessionId);
const requests = [];

const completeFake = async (model, request, options) => {
  requests.push({ model, request, options });
  return { content: [{ type: "text", text: "APPROVE: План валиден." }], usage: { input_tokens: 50, output_tokens: 10 } };
};

const policy = createPlanProtectionForTest({ complete: completeFake });
const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: false,
  ui: { notify() {} },
  models: { resolve() { return { provider: "test", id: "test-advisor" }; }, current() { return undefined; } },
  modelRegistry: { async getApiKey() { return "test-key"; } },
};

try {
  await fs.mkdir(localRoot, { recursive: true });

  // Integration Test A: Proposing empty file -> blocked by validator, 0 advisor calls
  await fs.writeFile(path.join(localRoot, "empty-plan.md"), "   \n\n  ", "utf8");
  const emptyBlock = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-empty",
    input: { path: "xd://propose", content: "empty" },
  }, context);

  assert.equal(emptyBlock?.block, true);
  assert.match(emptyBlock.reason, /PLAN_VALIDATOR_BLOCK/);
  assert.match(emptyBlock.reason, /PLAN_EMPTY/);
  assert.equal(requests.length, 0, "Validator failure must never call advisor");

  // Integration Test B: Proposing plan missing all 3 sections -> all 3 returned in one packet, 0 advisor calls
  await fs.writeFile(path.join(localRoot, "missing-plan.md"), "# Bad Plan\nNo sections here\n", "utf8");
  const missingBlock = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-missing",
    input: { path: "xd://propose", content: "missing" },
  }, context);

  assert.equal(missingBlock?.block, true);
  assert.match(missingBlock.reason, /PLAN_VALIDATOR_BLOCK/);
  assert.match(missingBlock.reason, /SECTION_MISSING.*Context/);
  assert.match(missingBlock.reason, /SECTION_MISSING.*Approach/);
  assert.match(missingBlock.reason, /SECTION_MISSING.*Verification/);
  assert.equal(requests.length, 0, "Multiple validator failures must never call advisor");

  // Integration Test C: Proposing plan with code fence header -> blocked because heading was inside fence
  const fenceContent = [
    "## Context",
    "Context",
    "```markdown",
    "## Approach",
    "```",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "fenced-plan.md"), fenceContent, "utf8");
  const fencedBlock = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-fenced",
    input: { path: "xd://propose", content: "fenced" },
  }, context);

  assert.equal(fencedBlock?.block, true);
  assert.match(fencedBlock.reason, /SECTION_MISSING.*Approach/);
  assert.equal(requests.length, 0, "Fenced heading failure must never call advisor");

  // Integration Test D: Proposing non-actionable plan -> blocked by validator with 0 advisor calls
  const nonActionableContent = [
    "# Non-Actionable",
    "## Context",
    "Context description.",
    "## Approach",
    "Update the validator.",
    "## Verification",
    "Run tests.",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "non-actionable-plan.md"), nonActionableContent, "utf8");
  const nonActionableBlock = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-non-actionable",
    input: { path: "xd://propose", content: "non-actionable" },
  }, context);

  assert.equal(nonActionableBlock?.block, true);
  assert.match(nonActionableBlock.reason, /\[PLAN_VALIDATOR_BLOCK\]/);
  assert.match(nonActionableBlock.reason, /APPROACH_TARGET_MISSING/);
  assert.match(nonActionableBlock.reason, /VERIFICATION_NOT_ACTIONABLE/);
  assert.equal(requests.length, 0, "Non-actionable plan must block with 0 advisor calls");

  // Reset turn budget for next integration test
  await policy.handleAgentStart({ prompt: "Next turn for valid plan" }, context);

  // Integration Test E: Proposing valid minimal plan -> passes validator and reaches advisor
  const validContent = [
    "## Context",
    "Valid context description.",
    "## Approach",
    "1. Valid approach description in `src/feature.ts`.",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "valid-plan.md"), validContent, "utf8");
  const validPass = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-valid",
    input: { path: "xd://propose", content: "valid" },
  }, context);

  assert.equal(validPass, undefined, "Valid plan proposal must pass validator and advisor");
  assert.equal(requests.length, 1, "Advisor must be called exactly once for valid plan");

  // Reset turn budget for next integration test
  await policy.handleAgentStart({ prompt: "Next turn for UI plan" }, context);

  // Integration Test F: Proposing valid UI plan without CLI -> passes validator and reaches advisor
  const uiContent = [
    "## Context",
    "Valid UI context description.",
    "## Approach",
    "1. Configure settings in `Settings > Billing`.",
    "## Verification",
    "- `Settings > Billing` → confirmation is visible",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "ui-plan.md"), uiContent, "utf8");
  const uiPass = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-ui",
    input: { path: "xd://propose", content: "ui" },
  }, context);

  assert.equal(uiPass, undefined, "Valid UI plan proposal must pass validator and reach advisor");
  assert.equal(requests.length, 2, "Advisor must be called for valid UI plan");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-validator-e2e@2",
    decision: "pass",
    features: {
      planEmptyDetected: true,
      allThreeMissingSectionsReturnedTogether: true,
      duplicateDetectedWithExactLine: true,
      orderDetectedWithExactLine: true,
      emptySectionDetectedWithExactLine: true,
      dependentErrorsSuppressed: true,
      codeFenceHeadingsIgnored: true,
      validMinimalPlanPasses: true,
      validFullPlanPasses: true,
      approachTargetMissingDetectedWithExactLine: true,
      verificationNotActionableDetectedWithExactLine: true,
      combinedNonActionableErrorsReturnedTogether: true,
      validUIPlanWithoutCLIPasses: true,
      cyrillicExpectedPasses: true,
      issueSignatureStableAcrossCosmetics: true,
      formatRepairPacketContractCompliant: true,
      zeroAdvisorCallsOnValidatorFailures: true,
      validPlanReachesAdvisor: true,
    },
    totalValidatorTests: 23,
    advisorCalls: requests.length,
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
