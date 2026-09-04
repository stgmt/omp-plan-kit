import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const home = os.homedir();
const installedExtension = path.join(process.cwd(), "dist", "extension.js");
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
    "Approach details here", // 5
    "## Verification", // 6
    "Verification commands here", // 7
  ].join("\n");

  const issues = validatePlanStructure(emptySectionMarkdown);
  const emptyIssues = issues.filter((i) => i.code === "SECTION_EMPTY");
  assert.equal(emptyIssues.length, 1);
  assert.equal(emptyIssues[0].section, "Context");
  assert.equal(emptyIssues[0].line, 1);
}

// 6. Suppression of dependent errors (missing section does not trigger SECTION_EMPTY or SECTION_ORDER)
{
  const missingOnly = [
    "## Verification", // 1
    "Some verification commands", // 2
  ].join("\n");

  const issues = validatePlanStructure(missingOnly);
  // Context and Approach are missing
  const missingCodes = issues.filter((i) => i.code === "SECTION_MISSING");
  assert.equal(missingCodes.length, 2);
  // No SECTION_EMPTY or SECTION_ORDER for missing Context or Approach
  const contextIssues = issues.filter((i) => i.section === "Context");
  assert.equal(contextIssues.length, 1);
  assert.equal(contextIssues[0].code, "SECTION_MISSING");

  const approachIssues = issues.filter((i) => i.section === "Approach");
  assert.equal(approachIssues.length, 1);
  assert.equal(approachIssues[0].code, "SECTION_MISSING");
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
    "Verification commands",
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
    "1. Step one",
    "2. Step two",
    "## Verification",
    "Run tests and verify exit code.",
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
    "Implementation plan.",
    "## Critical files & anchors",
    "- src/index.ts: main entry",
    "## Verification",
    "bun test",
    "## Assumptions & contingencies",
    "Contingency plan here.",
  ].join("\n");

  const issues = validatePlanStructure(validFull);
  assert.equal(issues.length, 0, "Valid full plan must have 0 issues");
}

// 10. issueSignature stability
{
  const issues1 = validatePlanStructure([
    "## Context",
    "",
    "## Verification",
    "V",
    "## Approach",
    "A",
  ].join("\n"));

  const issues2 = validatePlanStructure([
    "## Context",
    "",
    "",
    "",
    "## Verification",
    "V",
    "",
    "## Approach",
    "A",
  ].join("\n"));

  // Issues have different line numbers due to empty lines:
  assert.notEqual(issues1[1].line, issues2[1].line);
  // But signatures must be identical:
  assert.equal(issueSignature(issues1), issueSignature(issues2), "Cosmetic line changes must produce identical issueSignature");
  assert.equal(issueSignature([]), "", "Empty issues list must have empty signature");
}

// 11. formatRepairPacket
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
    "Verification",
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

  // Integration Test D: Proposing valid minimal plan -> passes validator and reaches advisor
  const validContent = [
    "## Context",
    "Valid context description.",
    "## Approach",
    "Valid approach description.",
    "## Verification",
    "Valid verification description.",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "valid-plan.md"), validContent, "utf8");
  const validPass = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "call-valid",
    input: { path: "xd://propose", content: "valid" },
  }, context);

  assert.equal(validPass, undefined, "Valid plan proposal must pass validator and advisor");
  assert.equal(requests.length, 1, "Advisor must be called exactly once for valid plan");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-validator-e2e@1",
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
      issueSignatureStableAcrossCosmetics: true,
      formatRepairPacketContractCompliant: true,
      zeroAdvisorCallsOnValidatorFailures: true,
      validPlanReachesAdvisor: true,
    },
    totalValidatorTests: 15,
    advisorCalls: requests.length,
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
