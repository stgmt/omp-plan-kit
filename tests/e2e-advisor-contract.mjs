import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "1";
process.env.OMP_PLAN_ADVISOR_MAX_CALLS = "3";
process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS = "0";
process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS = "1000";
process.env.OMP_PLAN_ADVISOR_MAX_TOKENS = "160";

const home = os.homedir();
const installedExtension = path.join(process.cwd(), "dist", "extension.js");
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadLegacyPiModule } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/plugins/legacy-pi-compat.ts")).href);
const { createPlanProtectionForTest } = await loadLegacyPiModule(installedExtension);
const requests = [];
const completeFake = async (model, request, options) => {
  requests.push({ model, request, options });
  const prompt = request.messages[0].content[0].text;
  if (prompt.toLowerCase().includes("bad-plan")) {
    return { content: [{ type: "text", text: "REJECT: План затрагивает запрещённый upstream OMP компонент." }], usage: { input_tokens: 80, output_tokens: 15 } };
  }
  return { content: [{ type: "text", text: "APPROVE: План проверен, задачи корректны." }], usage: { input_tokens: 75, output_tokens: 12 } };
};

const policy = createPlanProtectionForTest({ complete: completeFake });
const sessionId = `standalone-advisor-contract-${process.pid}-${Date.now()}`;
const localRoot = path.join(os.tmpdir(), "omp-local", sessionId);
const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: false,
  ui: { notify() {} },
  models: { resolve() { return { provider: "test", id: "test-advisor" }; }, current() { return undefined; } },
  modelRegistry: { async getApiKey() { return "test-key"; } },
};

async function waitForRequests(expected) {
  for (let attempt = 0; attempt < 40 && requests.length < expected; attempt += 1) await Promise.resolve();
  assert.equal(requests.length, expected, `expected ${expected} bounded advisor call(s)`);
}

try {
  await fs.mkdir(localRoot, { recursive: true });

  // Test 1: Syntax error (malformed Markdown slug) blocks deterministically with ZERO LLM calls
  const badInput = { path: "xd://propose", content: "# Markdown plan with /private/path" };
  const blocked = await policy.handleToolCall({ toolName: "write", toolCallId: "invalid-1", input: badInput }, context);
  assert.equal(blocked?.block, true);
  assert.match(blocked.reason, /NON_SLUG_PAYLOAD/);
  assert.equal(requests.length, 0, "Syntax errors must block deterministically without burning advisor tokens");

  // Test 2: Intermediate todo actions MUST NOT trigger the advisor (Zero token waste during planning!)
  await policy.handleAgentStart({ prompt: "Не нужен upstream OMP и authority ABI; работаем только в проекте." }, context);
  await policy.handleToolCall({ toolName: "todo", toolCallId: "todo-1", input: { op: "append", items: ["Add upstream OMP patch"] } }, context);
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
  assert.equal(requests.length, 0, "todo operations during planning must never trigger the advisor");

  // Test 2b: Structurally invalid plan must block deterministically with ZERO advisor calls
  await fs.writeFile(path.join(localRoot, "structurally-invalid-plan.md"), "# Bad Plan\nNo sections\n", "utf8");
  const structBlock = await policy.handleToolCall({
    toolName: "write",
    toolCallId: "propose-struct-bad",
    input: { path: "xd://propose", content: "structurally-invalid" },
  }, context);
  assert.equal(structBlock?.block, true);
  assert.match(structBlock.reason, /PLAN_VALIDATOR_BLOCK/);
  assert.equal(requests.length, 0, "Structurally invalid plan must never reach advisor");

  // Test 3: Proposal of a defective plan artifact (structurally valid, but advisory defect) -> PLAN ADVISOR RUNS and BLOCKS
  const badPlanContent = [
    "# bad-plan",
    "## Context",
    "Targeting upstream OMP core internals.",
    "## Approach",
    "Step 1: add upstream patch in `src/core.ts`.",
    "## Verification",
    "`bun test` → exit code 0",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "bad-plan.md"), badPlanContent, "utf8");
  const advisorBlock = await policy.handleToolCall({ toolName: "write", toolCallId: "propose-bad", input: { path: "xd://propose", content: "bad" } }, context);
  await waitForRequests(1);
  assert.equal(advisorBlock?.block, true, "Plan Advisor must return a hard block for defective plan");
  assert.match(advisorBlock.reason, /PLAN_ADVISOR_BLOCK/, "Block reason must cite PLAN_ADVISOR_BLOCK");
  assert.match(advisorBlock.reason, /upstream/iu, "Block reason must cite advisor rejection critique");

  // Test 4: Proposal of a clean plan (structurally valid and safe) -> PLAN ADVISOR RUNS and APPROVES
  const cleanPlanContent = [
    "# clean-plan",
    "## Context",
    "Safe in-tree project enhancement.",
    "## Approach",
    "Step 1: implement safe feature within project in `src/utils.ts`.",
    "## Verification",
    "`bun test` → all tests pass",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "clean-plan.md"), cleanPlanContent, "utf8");
  const allowed = await policy.handleToolCall({ toolName: "write", toolCallId: "propose-clean", input: { path: "xd://propose", content: "clean" } }, context);
  await waitForRequests(2);
  assert.equal(allowed, undefined, "clean proposal must pass after advisor approval");

  // Test 5: Re-proposing unchanged clean plan must hit cache (Zero extra advisor calls!)
  await policy.handleToolCall({ toolName: "write", toolCallId: "propose-clean-repeat", input: { path: "xd://propose", content: "clean" } }, context);
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
  assert.equal(requests.length, 2, "re-proposing unchanged plan must use cache with 0 extra calls");

  // Test 6: Verify strict token and model constraints on all advisor calls
  const requestShapes = requests.map(({ model, request, options }) => {
    const prompt = request.messages[0].content[0].text;
    assert.equal(options.maxTokens, 160, "advisor must cap maxTokens to 160");
    assert.equal(options.disableReasoning, true, "advisor must disable reasoning to save tokens");
    assert.ok(options.signal instanceof AbortSignal, "advisor must pass abort signal timeout");
    assert.equal(request.messages.length, 1, "advisor must use single prompt message");
    assert.ok(prompt.length < 2500, "prompt must be strictly bounded");
    return { provider: model.provider, model: model.id, maxTokens: options.maxTokens, disableReasoning: options.disableReasoning, promptChars: prompt.length };
  });

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-advisor-contract-e2e@5",
    decision: "pass",
    features: {
      zeroWasteOnSyntaxError: true,
      zeroWasteOnTodo: true,
      zeroWasteOnStructuralError: true,
      planAdvisorRanOnDefectivePlan: true,
      planAdvisorBlockedHandoff: true,
      planAdvisorRanOnCleanPlan: true,
      cleanPlanApproved: true,
      deduplicatedRepeatHitCache: true,
    },
    totalAdvisorCalls: requests.length,
    planAdvisorBlockReason: advisorBlock.reason,
    requestShapes,
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
