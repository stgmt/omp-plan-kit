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
const installedExtension = process.env.OMP_PLAN_KIT_EXTENSION_PATH
  ? path.resolve(process.env.OMP_PLAN_KIT_EXTENSION_PATH)
  : path.join(process.cwd(), "dist", "extension.js");
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
const contextHandler = plugin?.handlers.get("context")?.[0];

assert.ok(toolHandler, "tool_call handler must be registered");
assert.ok(startHandler, "before_agent_start handler must be registered");
assert.ok(contextHandler, "context handler must be registered");
assert.equal(typeof extensionModule.PLAN_CORE_TEMPLATE, "string", "bundle must export the plan-core template");

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

async function createIsolatedContext(name, activatePlanMode) {
  const isolatedSessionId = `${sessionId}-${name}`;
  const isolated = {
    ...context,
    sessionManager: {
      getSessionId: () => isolatedSessionId,
      getBranch: () => [],
    },
  };
  await startHandler({ prompt: `Plan handoff scenario: ${name}` }, isolated);
  if (activatePlanMode) {
    const marker = {
      role: "custom",
      customType: "plan-mode-context",
      content: "native plan-mode instructions",
      display: false,
      attribution: "agent",
      timestamp: Date.now(),
    };
    const activated = await contextHandler({ type: "context", messages: [marker] }, isolated);
    const builtIn = activated?.messages?.find(
      (message) => message?.details?.id === "omp-plan-kit:format-contract",
    );
    assert.ok(
      builtIn?.content.includes(extensionModule.PLAN_CORE_TEMPLATE),
      `${name}: plan entry must inject the exact plan-core template`,
    );
  }
  return isolated;
}

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

  // Phase 2c: Non-actionable plan (Approach without exact target, Verification without actionable proof)
  // is blocked by validator with ZERO advisor calls and no core dispatch
  const nonActionableContent = [
    "# Non-Actionable Plan",
    "## Context",
    "Add new feature.",
    "## Approach",
    "Update the validator.",
    "## Verification",
    "Run tests.",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "non-actionable-plan.md"), nonActionableContent, "utf8");
  dispatchedToCore = false;
  coreSelectedPlan = null;

  const nonActionableResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-non-actionable",
    input: { path: "xd://propose", content: "non-actionable" },
  }, context);

  assert.equal(nonActionableResult?.block, true);
  assert.match(nonActionableResult.reason, /\[PLAN_VALIDATOR_BLOCK\]/);
  assert.match(nonActionableResult.reason, /APPROACH_TARGET_MISSING/);
  assert.match(nonActionableResult.reason, /VERIFICATION_NOT_ACTIONABLE/);
  assert.equal(advisorCalls.length, 0, "Non-actionable plan must NEVER invoke advisor");
  assert.equal(dispatchedToCore, false, "Non-actionable plan must never reach core dispatch");
  assert.equal(coreSelectedPlan, null, "Human review dialog must not open for non-actionable plan");

  // Phase 3: Agent drafts a DEFECTIVE plan (structurally valid and actionable, but violates safety rules)
  const badFeatureContent = [
    "# Bad Feature Plan",
    "## Context",
    "Modifying upstream OMP components.",
    "## Approach",
    "1. Patch upstream OMP in `src/extensibility/extensions/runner.ts` to bypass guards.",
    "## Verification",
    "- `bun test` → exit code 0",
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
  assert.equal(advisorCalls.length, 1, "Advisor MUST execute exactly once when structurally valid and actionable plan is proposed");
  assert.equal(blockedResult?.block, true, "Defective proposal MUST be blocked by advisor");
  assert.match(blockedResult.reason, /\[PLAN_ADVISOR_BLOCK\]/, "Must contain [PLAN_ADVISOR_BLOCK]");
  assert.match(blockedResult.reason, /OMP/iu, "Must cite advisor rejection reason");
  assert.equal(dispatchedToCore, false, "Core dispatch must NEVER be reached when advisor blocks");
  assert.equal(coreSelectedPlan, null, "Human review dialog must NOT open for rejected plan");

  // Phase 4: Agent fixes the plan into an actionable UI-plan without CLI (structurally valid, actionable, and safe)
  const fixedFeatureContent = [
    "# Fixed Feature Plan",
    "## Context",
    "Purely local plugin development.",
    "## Approach",
    "1. Configure settings in `Settings > Billing` within project UI boundaries.",
    "## Verification",
    "- `Settings > Billing` → confirmation is visible",
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
  assert.equal(advisorCalls.length, 2, "Advisor MUST execute to review the newly proposed UI plan");
  assert.equal(allowedResult, undefined, "Clean UI plan proposal must be allowed to pass the guard");

  // Since guard allowed it, OMP resolution device receives the proposal
  const coreResult = await dispatchResolutionDevice(ompSession, "propose", "fixed-feature");
  assert.equal(dispatchedToCore, true, "Clean UI proposal successfully reaches OMP core dispatch");
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
    "1. Refine `src/plan-validator.ts#validatePlanStructure` with additional checks.",
    "## Verification",
    "- `bun run check && bun tests/e2e-real-plan-handoff.mjs` → exit code 0",
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

  // Given an isolated session that entered Plan Mode,
  // When it proposes actionable Markdown without the injected core,
  // Then strict validation blocks before the advisor and native review.
  const requiredMissingContext = await createIsolatedContext("required-missing", true);
  const requiredMissingContent = [
    "## Context",
    "Strict session without the machine-readable header.",
    "## Approach",
    "1. Update `src/extension.ts#createPlanProtectionForTest`.",
    "## Verification",
    "- `bun tests/e2e-real-plan-handoff.mjs` -> exit code 0",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-missing-plan.md"), requiredMissingContent, "utf8");
  const callsBeforeRequiredMissing = advisorCalls.length;
  const requiredMissing = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-missing",
    input: { path: "xd://propose", content: "required-missing" },
  }, requiredMissingContext);
  assert.equal(requiredMissing?.block, true, "activated session without a core must block");
  assert.match(requiredMissing.reason, /PLAN_CORE_REQUIRED/);
  assert.equal(advisorCalls.length, callsBeforeRequiredMissing, "missing required core must spend zero advisor calls");

  // Given a second activated session,
  // When its leading core is malformed JSON,
  // Then core validation blocks before the advisor.
  const requiredMalformedContext = await createIsolatedContext("required-malformed", true);
  const requiredMalformedContent = [
    "---",
    '{ "sections": { "context": "broken", } }',
    "---",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-malformed-plan.md"), requiredMalformedContent, "utf8");
  const callsBeforeRequiredMalformed = advisorCalls.length;
  const requiredMalformed = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-malformed",
    input: { path: "xd://propose", content: "required-malformed" },
  }, requiredMalformedContext);
  assert.equal(requiredMalformed?.block, true, "malformed required core must block");
  assert.match(requiredMalformed.reason, /PLAN_CORE_INVALID/);
  assert.equal(advisorCalls.length, callsBeforeRequiredMalformed, "malformed required core must spend zero advisor calls");

  // Given a third activated session,
  // When required core fields are empty,
  // Then field validation blocks before the advisor.
  const requiredIncompleteContext = await createIsolatedContext("required-incomplete", true);
  const requiredIncompleteContent = [
    "---",
    JSON.stringify({ sections: { context: "", approach: [], verification: [] } }, null, 2),
    "---",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-incomplete-plan.md"), requiredIncompleteContent, "utf8");
  const callsBeforeRequiredIncomplete = advisorCalls.length;
  const requiredIncomplete = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-incomplete",
    input: { path: "xd://propose", content: "required-incomplete" },
  }, requiredIncompleteContext);
  assert.equal(requiredIncomplete?.block, true, "incomplete required core must block");
  assert.match(requiredIncomplete.reason, /PLAN_CORE_INVALID/);
  assert.match(requiredIncomplete.reason, /sections\.context/);
  assert.match(requiredIncomplete.reason, /sections\.approach/);
  assert.match(requiredIncomplete.reason, /sections\.verification/);
  assert.equal(advisorCalls.length, callsBeforeRequiredIncomplete, "incomplete required core must spend zero advisor calls");

  // Given a fourth activated session,
  // When it proposes a complete core,
  // Then the advisor runs and native plan review receives the exact artifact.
  const requiredValidContext = await createIsolatedContext("required-valid", true);
  const requiredValidContent = [
    "---",
    JSON.stringify({
      sections: {
        context: "Session-scoped strict plan handoff.",
        approach: [{ action: "Keep enforcement in the plugin policy", target: "src/extension.ts#createPlanProtectionForTest" }],
        verification: [{ command: "bun tests/e2e-real-plan-handoff.mjs", expects: "exit code 0" }],
      },
    }, null, 2),
    "---",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-valid-plan.md"), requiredValidContent, "utf8");
  const callsBeforeRequiredValid = advisorCalls.length;
  const requiredValid = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-valid",
    input: { path: "xd://propose", content: "required-valid" },
  }, requiredValidContext);
  assert.equal(requiredValid, undefined, "complete required core must pass the guard");
  assert.equal(advisorCalls.length, callsBeforeRequiredValid + 1, "complete required core must invoke advisor once");
  dispatchedToCore = false;
  coreSelectedPlan = null;
  const requiredValidCoreResult = await dispatchResolutionDevice(ompSession, "propose", "required-valid");
  assert.equal(dispatchedToCore, true, "complete required core must reach native plan review");
  assert.equal(requiredValidCoreResult.xdev.inner.planFilePath, "local://required-valid-plan.md");
  assert.equal(coreSelectedPlan, "local://required-valid-plan.md");

  // Given a separate session that never received the public Plan Mode event,
  // When it proposes legacy Markdown,
  // Then backward-compatible Markdown validation still passes.
  const legacyContext = await createIsolatedContext("legacy-compatible", false);
  const legacyCompatibleContent = [
    "## Context",
    "Legacy direct proposal outside the Plan Mode hook.",
    "## Approach",
    "1. Keep compatibility in `src/plan-validator.ts#validatePlanStructure`.",
    "## Verification",
    "- `bun tests/e2e-plan-validator.mjs` -> exit code 0",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "legacy-compatible-plan.md"), legacyCompatibleContent, "utf8");
  const callsBeforeLegacy = advisorCalls.length;
  const legacyCompatible = await toolHandler({
    toolName: "write",
    toolCallId: "propose-legacy-compatible",
    input: { path: "xd://propose", content: "legacy-compatible" },
  }, legacyContext);
  assert.equal(legacyCompatible, undefined, "legacy Markdown outside activated Plan Mode must stay allowed");
  assert.equal(advisorCalls.length, callsBeforeLegacy + 1, "legacy compatible plan must still reach advisor");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-real-handoff-e2e@5",
    decision: "pass",
    scenarios: {
      zeroWasteOnIntermediateTodo: true,
      validatorBlockedInvalidStructure: true,
      validatorBlockedNonActionablePlan: true,
      advisorRanOnDefectivePlan: true,
      advisorBlockedDefectivePlan: true,
      advisorRanOnCleanPlan: true,
      cleanUIPlanApprovedAndDispatchedToCore: true,
      unchangedPlanHitCache: true,
      refineResetsCycleAndDispatchesRefinedPlan: true,
      activatedSessionRequiresCore: true,
      malformedRequiredCoreBlocksBeforeAdvisor: true,
      incompleteRequiredCoreBlocksBeforeAdvisor: true,
      validRequiredCoreReachesNativeReview: true,
      legacyMarkdownOutsideActivatedSession: true,
    },
    totalAdvisorCalls: advisorCalls.length,
    blockedReason: blockedResult.reason,
    approvedNotification: notifications[notifications.length - 1]?.message,
    coreSelectedPlan,
  }, null, 2)}\n`);
} finally {
  await fs.rm(artifactsDir, { recursive: true, force: true });
}
