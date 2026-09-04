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
const { createPlanProtectionForTest } = extensionModule;
assert.equal(typeof createPlanProtectionForTest, "function");

const sessionId = `convergence-e2e-${process.pid}-${Date.now()}`;
const localRoot = path.join(os.tmpdir(), "omp-local", sessionId);

let advisorCalls = 0;
const completeFake = async () => {
  advisorCalls += 1;
  return { content: [{ type: "text", text: "APPROVE: OK" }] };
};

let abortCalls = 0;
let notifyCalls = 0;
const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: true,
  ui: {
    notify() {
      notifyCalls += 1;
    },
  },
  abort() {
    abortCalls += 1;
  },
  models: { resolve() { return { provider: "test", id: "test-advisor" }; }, current() { return undefined; } },
  modelRegistry: { async getApiKey() { return "test-key"; } },
};

try {
  await fs.mkdir(localRoot, { recursive: true });

  // -----------------------------------------------------------------------
  // Test 1: Error reduction allows next attempt (progress detected)
  // -----------------------------------------------------------------------
  {
    const policy = createPlanProtectionForTest({ complete: completeFake });
    await policy.handleAgentStart({ prompt: "User task 1" }, context);

    // Attempt 1: missing Context, Approach, Verification (3 errors)
    await fs.writeFile(path.join(localRoot, "prog-plan.md"), "# Title\nNo sections\n", "utf8");
    const res1 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "c1",
      input: { path: "xd://propose", content: "prog" },
    }, context);
    assert.equal(res1?.block, true);
    assert.match(res1.reason, /Attempt 1 of 3/);
    assert.equal(advisorCalls, 0);

    // Attempt 2: adds Context and Approach, but Verification still missing (1 error < 3 errors)
    const prog2 = "## Context\nContext text\n## Approach\nApproach text\n";
    await fs.writeFile(path.join(localRoot, "prog-plan.md"), prog2, "utf8");
    const res2 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "c2",
      input: { path: "xd://propose", content: "prog" },
    }, context);
    assert.equal(res2?.block, true);
    assert.match(res2.reason, /Attempt 2 of 3/);
    assert.match(res2.reason, /\[SECTION_MISSING\] Verification/);
    assert.equal(advisorCalls, 0);

    // Attempt 3: adds Verification -> valid, passes to advisor!
    const prog3 = prog2 + "## Verification\nVerification text\n";
    await fs.writeFile(path.join(localRoot, "prog-plan.md"), prog3, "utf8");
    const res3 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "c3",
      input: { path: "xd://propose", content: "prog" },
    }, context);
    assert.equal(res3, undefined, "Passing validator allows proposal to reach advisor");
    assert.equal(advisorCalls, 1, "Advisor called exactly once on valid proposal");
  }

  // -----------------------------------------------------------------------
  // Test 2: Hash churn without reduction is stopped after 2 no-progress attempts
  // -----------------------------------------------------------------------
  {
    const policy = createPlanProtectionForTest({ complete: completeFake });
    await policy.handleAgentStart({ prompt: "User task 2" }, context);

    // Attempt 1: missing Approach and Verification (2 errors)
    await fs.writeFile(path.join(localRoot, "churn-plan.md"), "## Context\nVersion 1\n", "utf8");
    const res1 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "churn1",
      input: { path: "xd://propose", content: "churn" },
    }, context);
    assert.equal(res1?.block, true);
    assert.match(res1.reason, /Attempt 1 of 3/);

    // Attempt 2: changed text (new SHA), but still 2 errors (Approach and Verification missing) -> no-progress count = 1
    await fs.writeFile(path.join(localRoot, "churn-plan.md"), "## Context\nVersion 2 with different content\n", "utf8");
    const res2 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "churn2",
      input: { path: "xd://propose", content: "churn" },
    }, context);
    assert.equal(res2?.block, true);
    assert.match(res2.reason, /Attempt 2 of 3/);

    // Attempt 3: changed text (new SHA), still 2 errors -> no-progress count = 2 -> STOPPED!
    await fs.writeFile(path.join(localRoot, "churn-plan.md"), "## Context\nVersion 3 with more text\n", "utf8");
    const res3 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "churn3",
      input: { path: "xd://propose", content: "churn" },
    }, context);
    assert.equal(res3?.block, true);
    assert.match(res3.reason, /PLAN_VALIDATOR_STOPPED/);
    assert.match(res3.reason, /no-progress limit reached/);

    // Sticky stop check on churn:
    const resSticky = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "churn4",
      input: { path: "xd://propose", content: "churn" },
    }, context);
    assert.equal(resSticky?.block, true);
    assert.match(resSticky.reason, /PLAN_VALIDATOR_BLOCKED/);
  }

  // -----------------------------------------------------------------------
  // Test 3: Unchanged SHA does not run validator second time and stops after 2 repeats
  // -----------------------------------------------------------------------
  {
    let validatorExecutionCount = 0;
    const policy = createPlanProtectionForTest({
      complete: completeFake,
      validatePlan: (content) => {
        validatorExecutionCount += 1;
        return [{ code: "SECTION_MISSING", section: "Approach", message: "Approach missing", fix: "Add Approach" }];
      },
    });
    await policy.handleAgentStart({ prompt: "User task 3" }, context);

    await fs.writeFile(path.join(localRoot, "repeat-plan.md"), "## Context\nStatic content\n", "utf8");

    // Attempt 1: validates and rejects
    const res1 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "rep1",
      input: { path: "xd://propose", content: "repeat" },
    }, context);
    assert.equal(res1?.block, true);
    assert.equal(validatorExecutionCount, 1, "Validator must run on first proposal");
    assert.match(res1.reason, /Attempt 1 of 3/);

    // Repeat 1 (same SHA): must NOT run validator again!
    const res2 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "rep2",
      input: { path: "xd://propose", content: "repeat" },
    }, context);
    assert.equal(res2?.block, true);
    assert.equal(validatorExecutionCount, 1, "Validator must NOT execute on unchanged SHA repeat");
    assert.match(res2.reason, /Plan file is unchanged/);

    // Repeat 2 (same SHA): reaches MAX_SAME_HASH_REPEATS -> STOPPED!
    const res3 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "rep3",
      input: { path: "xd://propose", content: "repeat" },
    }, context);
    assert.equal(res3?.block, true);
    assert.equal(validatorExecutionCount, 1, "Validator must NOT execute on second repeat");
    assert.match(res3.reason, /PLAN_VALIDATOR_STOPPED/);
    assert.match(res3.reason, /Plan file was repeated without changes/);

    // Fast sticky check:
    const res4 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "rep4",
      input: { path: "xd://propose", content: "repeat" },
    }, context);
    assert.equal(res4?.block, true);
    assert.equal(validatorExecutionCount, 1, "Validator must NOT run after cycle blocked");
    assert.match(res4.reason, /PLAN_VALIDATOR_BLOCKED/);
  }

  // -----------------------------------------------------------------------
  // Test 4: 5th proposal with slug hopping in same turn gives PLAN_VALIDATOR_TURN_BLOCKED
  // -----------------------------------------------------------------------
  {
    const policy = createPlanProtectionForTest({ complete: completeFake });
    await policy.handleAgentStart({ prompt: "User task 4" }, context);

    for (let i = 1; i <= 4; i++) {
      const slug = `slug-${i}`;
      await fs.writeFile(path.join(localRoot, `${slug}-plan.md`), `# Incomplete ${i}\n`, "utf8");
      const res = await policy.handleToolCall({
        toolName: "write",
        toolCallId: `hop-${i}`,
        input: { path: "xd://propose", content: slug },
      }, context);
      assert.equal(res?.block, true);
      assert.match(res.reason, /PLAN_VALIDATOR_BLOCK/);
    }

    // 5th proposal with yet another slug in the same turn -> TURN BLOCKED!
    const slug5 = "slug-5";
    await fs.writeFile(path.join(localRoot, `${slug5}-plan.md`), `# Incomplete 5\n`, "utf8");
    const res5 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "hop-5",
      input: { path: "xd://propose", content: slug5 },
    }, context);
    assert.equal(res5?.block, true);
    assert.match(res5.reason, /PLAN_VALIDATOR_TURN_BLOCKED/);
    assert.match(res5.reason, /budget exceeded for this user turn/);

    // 6th proposal: still blocked
    const res6 = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "hop-6",
      input: { path: "xd://propose", content: "slug-6" },
    }, context);
    assert.equal(res6?.block, true);
    assert.match(res6.reason, /PLAN_VALIDATOR_TURN_BLOCKED/);

    // -----------------------------------------------------------------------
    // Test 5: Next handleAgentStart resets turn block and cycles
    // -----------------------------------------------------------------------
    await policy.handleAgentStart({ prompt: "New user prompt or native Refine" }, context);

    // Valid plan now passes without turn block!
    const validAfterReset = [
      "## Context",
      "Context after reset",
      "## Approach",
      "Approach after reset",
      "## Verification",
      "Verification after reset",
    ].join("\n");
    await fs.writeFile(path.join(localRoot, "fresh-plan.md"), validAfterReset, "utf8");
    const resFresh = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "fresh-call",
      input: { path: "xd://propose", content: "fresh" },
    }, context);
    assert.equal(resFresh, undefined, "handleAgentStart must reset turn block and allow valid handoff");
  }

  // -----------------------------------------------------------------------
  // Test 6: Validator exception blocks fail-closed
  // -----------------------------------------------------------------------
  {
    const policy = createPlanProtectionForTest({
      complete: completeFake,
      validatePlan: () => {
        throw new Error("Simulated deterministic validator crash");
      },
    });
    await policy.handleAgentStart({ prompt: "User task 5" }, context);
    await fs.writeFile(path.join(localRoot, "crash-plan.md"), "## Context\nText\n", "utf8");

    const res = await policy.handleToolCall({
      toolName: "write",
      toolCallId: "crash-call",
      input: { path: "xd://propose", content: "crash" },
    }, context);

    assert.equal(res?.block, true);
    assert.match(res.reason, /PLAN_VALIDATOR_INTERNAL_ERROR/);
    assert.match(res.reason, /Simulated deterministic validator crash/);
  }

  // -----------------------------------------------------------------------
  // Test 7: ctx.abort() has ZERO calls throughout
  // -----------------------------------------------------------------------
  assert.equal(abortCalls, 0, "ctx.abort() must NEVER be called inside tool_call hook");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-convergence-e2e@1",
    decision: "pass",
    features: {
      progressDetectedOnFewerErrors: true,
      noProgressChurnStoppedAfterLimit: true,
      unchangedShaDetectedWithoutRevalidation: true,
      unchangedShaStoppedAfterLimit: true,
      stickyStopBlockEffectiveInConstantTime: true,
      turnLimitEnforcedOnSlugHopping: true,
      agentStartResetsTurnBlockAndCycles: true,
      validatorExceptionBlocksFailClosed: true,
      ctxAbortRemainsZeroCalls: true,
      advisorZeroCallsOnDeterministicBlocks: true,
    },
    totalTests: 7,
    abortCalls,
    notifyCalls,
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
