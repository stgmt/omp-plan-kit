import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "1";
process.env.OMP_PLAN_ADVISOR_MAX_CALLS = "5";
process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS = "0";
process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS = "5000";
process.env.OMP_PLAN_ADVISOR_MAX_TOKENS = "160";

const home = os.homedir();
const installedExtension = path.join(process.cwd(), "dist", "extension.js");
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadExtensions } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href);
const { dispatchResolutionDevice } = await import(pathToFileURL(path.join(ompRoot, "src/tools/resolve.ts")).href);
const { resolveApprovedPlan } = await import(pathToFileURL(path.join(ompRoot, "src/plan-mode/approved-plan.ts")).href);
const extensionModule = await import(pathToFileURL(installedExtension).href);

// Record every advisor model invocation
const advisorCalls = [];
const mockComplete = async (model, request, options) => {
  advisorCalls.push({ model, request, options });
  const promptText = request.messages[0].content[0].text;

  // The advisor rejects plans attempting to touch upstream core OMP components
  if (promptText.toLowerCase().includes("upstream omp")) {
    return {
      content: [{ type: "text", text: "REJECT: План затрагивает запрещённый upstream OMP компонент." }],
      usage: { input_tokens: 85, output_tokens: 18 },
    };
  }

  // Otherwise, the advisor approves
  return {
    content: [{ type: "text", text: "APPROVE: План проверен, задачи корректны." }],
    usage: { input_tokens: 80, output_tokens: 12 },
  };
};

if (typeof extensionModule.setTestDependencies === "function") {
  extensionModule.setTestDependencies({ complete: mockComplete });
}

const loaded = await loadExtensions([installedExtension], process.cwd());
assert.deepEqual(loaded.errors, [], `OMP loader must import plugin cleanly: ${JSON.stringify(loaded.errors)}`);
const plugin = loaded.extensions[0];
const toolHandler = plugin?.handlers.get("tool_call")?.[0];
const startHandler = plugin?.handlers.get("before_agent_start")?.[0];

assert.ok(toolHandler, "tool_call handler must be registered");
assert.ok(startHandler, "before_agent_start handler must be registered");

const sessionId = `real-plan-handoff-e2e-${process.pid}-${Date.now()}`;
const artifactsDir = path.join(os.tmpdir(), `omp-plan-real-${process.pid}-${Date.now()}`);
const localRoot = path.join(artifactsDir, "local");
await fs.mkdir(localRoot, { recursive: true });

const notifications = [];
const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: true,
  ui: {
    notify(message, type) {
      notifications.push({ message, type });
    },
  },
  models: {
    resolve() {
      return { provider: "test", id: "test-advisor" };
    },
    current() {
      return undefined;
    },
  },
  modelRegistry: {
    async getApiKey() {
      return "test-api-key";
    },
  },
  localProtocolOptions: {
    getArtifactsDir: () => artifactsDir,
  },
};

let dispatchedToCore = false;
let coreSelectedPlan = null;
const ompSession = {
  peekPlanProposalHandler: () => async (title) => {
    dispatchedToCore = true;
    const resolved = await resolveApprovedPlan({
      suppliedTitle: title,
      statePlanFilePath: "local://old-draft-plan.md",
      readPlan: async (url) => {
        const rel = url.replace(/^local:\/\//u, "");
        try {
          return await fs.readFile(path.join(localRoot, rel), "utf8");
        } catch {
          return null;
        }
      },
      listPlanFiles: async () => {
        const files = await fs.readdir(localRoot);
        return files.filter((f) => f.endsWith("-plan.md")).map((f) => `local://${f}`);
      },
    });
    coreSelectedPlan = resolved.planFilePath;
    return {
      content: [{ type: "text", text: resolved.planFilePath }],
      details: { planFilePath: resolved.planFilePath, title: resolved.title, planExists: true },
    };
  },
};

try {
  // Phase 1: User prompt sets instructions and constraints
  await startHandler({
    prompt: "Сделай фичу строго в границах проекта, не трогая ядро OMP.",
  }, context);

  // Phase 2: Agent does intermediate planning actions (task updates)
  // MUST NOT trigger the advisor! ZERO tokens spent during planning!
  await toolHandler({
    toolName: "todo",
    toolCallId: "plan-draft-todo-1",
    input: { op: "init", items: ["Research code", "Draft solution", "Modify upstream OMP"] },
  }, context);

  assert.equal(advisorCalls.length, 0, "Advisor must NEVER run during intermediate planning turns");
  assert.equal(notifications.length, 0, "No notifications during intermediate planning");

  // Phase 2b: Structurally invalid plan is blocked by validator before advisor or core dispatch
  await fs.writeFile(
    path.join(localRoot, "invalid-structure-plan.md"),
    "# Invalid Plan\nMissing Context, Approach, Verification\n",
    "utf8",
  );
  dispatchedToCore = false;
  coreSelectedPlan = null;

  const structBlockResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-invalid-struct",
    input: { path: "xd://propose", content: "invalid-structure" },
  }, context);

  assert.equal(structBlockResult?.block, true);
  assert.match(structBlockResult.reason, /\[PLAN_VALIDATOR_BLOCK\]/);
  assert.equal(advisorCalls.length, 0, "Structurally invalid plan must NEVER invoke advisor");
  assert.equal(dispatchedToCore, false, "Structurally invalid plan must never reach core dispatch");
  assert.equal(coreSelectedPlan, null, "Human review dialog must not open for invalid plan");

  // Phase 3: Agent drafts a DEFECTIVE plan (structurally valid, but violates safety rules)
  const badFeatureContent = [
    "# Bad Feature Plan",
    "## Context",
    "Modifying upstream OMP components.",
    "## Approach",
    "Patch upstream OMP to bypass guards.",
    "## Verification",
    "Run tests.",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "bad-feature-plan.md"), badFeatureContent, "utf8");

  // Agent attempts to exit plan mode via write xd://propose bad-feature
  dispatchedToCore = false;
  coreSelectedPlan = null;

  const blockedResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-bad-call",
    input: { path: "xd://propose", content: "bad-feature" },
  }, context);

  // Assert advisor ACTUALLY RAN on this proposal!
  assert.equal(advisorCalls.length, 1, "Advisor MUST execute exactly once when structurally valid plan is proposed");
  assert.equal(blockedResult?.block, true, "Defective proposal MUST be blocked by advisor");
  assert.match(blockedResult.reason, /\[PLAN_ADVISOR_BLOCK\]/, "Must contain [PLAN_ADVISOR_BLOCK]");
  assert.match(blockedResult.reason, /OMP/iu, "Must cite advisor rejection reason");
  assert.equal(dispatchedToCore, false, "Core dispatch must NEVER be reached when advisor blocks");
  assert.equal(coreSelectedPlan, null, "Human review dialog must NOT open for rejected plan");

  // Phase 4: Agent fixes the plan based on advisor critique (structurally valid and safe)
  const fixedFeatureContent = [
    "# Fixed Feature Plan",
    "## Context",
    "Purely local plugin development.",
    "## Approach",
    "Purely local plugin implementation strictly within repository boundaries.",
    "## Verification",
    "bun tests/e2e-all.mjs",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "fixed-feature-plan.md"), fixedFeatureContent, "utf8");

  // Agent proposes the fixed plan
  dispatchedToCore = false;
  coreSelectedPlan = null;

  const allowedResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-fixed-call",
    input: { path: "xd://propose", content: "fixed-feature" },
  }, context);

  // Assert advisor RAN on the new plan proposal!
  assert.equal(advisorCalls.length, 2, "Advisor MUST execute to review the newly proposed plan");
  assert.equal(allowedResult, undefined, "Clean plan proposal must be allowed to pass the guard");

  // Since guard allowed it, OMP resolution device receives the proposal
  const coreResult = await dispatchResolutionDevice(ompSession, "propose", "fixed-feature");
  assert.equal(dispatchedToCore, true, "Clean proposal successfully reaches OMP core dispatch");
  assert.equal(coreResult.xdev.inner.planFilePath, "local://fixed-feature-plan.md");
  assert.equal(coreSelectedPlan, "local://fixed-feature-plan.md", "Human review dialog opens with the approved plan!");

  // Phase 5: Re-proposing unchanged plan uses CACHE (deduplication) - zero extra tokens!
  const callsBeforeRePropose = advisorCalls.length;
  await toolHandler({
    toolName: "write",
    toolCallId: "propose-repeat-call",
    input: { path: "xd://propose", content: "fixed-feature" },
  }, context);
  assert.equal(advisorCalls.length, callsBeforeRePropose, "Re-proposing unchanged plan must hit cache and spend 0 extra tokens");

  // Phase 6: Native Refine (handleAgentStart) resets convergence cycle and allows new proposal
  await startHandler({
    prompt: "Refine plan: add more verification commands",
  }, context);

  const refinedFeatureContent = [
    "# Refined Feature Plan",
    "## Context",
    "Refined in-tree implementation.",
    "## Approach",
    "Step 1: refine approach with additional tests.",
    "## Verification",
    "bun run check && bun tests/e2e-real-plan-handoff.mjs",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "refined-feature-plan.md"), refinedFeatureContent, "utf8");

  dispatchedToCore = false;
  coreSelectedPlan = null;

  const refinedAllowed = await toolHandler({
    toolName: "write",
    toolCallId: "propose-refined-call",
    input: { path: "xd://propose", content: "refined-feature" },
  }, context);

  assert.equal(refinedAllowed, undefined, "Refined proposal must pass validator and advisor after reset");
  assert.equal(advisorCalls.length, 3, "Advisor must run on new refined proposal");

  const coreRefinedResult = await dispatchResolutionDevice(ompSession, "propose", "refined-feature");
  assert.equal(dispatchedToCore, true, "Refined proposal reaches OMP core dispatch");
  assert.equal(coreRefinedResult.xdev.inner.planFilePath, "local://refined-feature-plan.md");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-real-handoff-e2e@3",
    decision: "pass",
    scenarios: {
      zeroWasteOnIntermediateTodo: true,
      validatorBlockedInvalidStructure: true,
      advisorRanOnDefectivePlan: true,
      advisorBlockedDefectivePlan: true,
      advisorRanOnCleanPlan: true,
      cleanPlanApprovedAndDispatchedToCore: true,
      unchangedPlanHitCache: true,
      refineResetsCycleAndDispatchesRefinedPlan: true,
    },
    totalAdvisorCalls: advisorCalls.length,
    blockedReason: blockedResult.reason,
    approvedNotification: notifications[notifications.length - 1]?.message,
    coreSelectedPlan,
  }, null, 2)}\n`);
} finally {
  await fs.rm(artifactsDir, { recursive: true, force: true });
}
