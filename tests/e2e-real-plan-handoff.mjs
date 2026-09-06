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
const { loadExtensions } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href);
const { dispatchResolutionDevice } = await import(pathToFileURL(path.join(ompRoot, "src/tools/resolve.ts")).href);
const { resolveApprovedPlan } = await import(pathToFileURL(path.join(ompRoot, "src/plan-mode/approved-plan.ts")).href);
const extensionModule = await import(pathToFileURL(installedExtension).href);

const loaded = await loadExtensions([installedExtension], process.cwd());
assert.deepEqual(loaded.errors, [], `OMP loader must import plugin cleanly: ${JSON.stringify(loaded.errors)}`);
const plugin = loaded.extensions[0];
const toolHandler = plugin?.handlers.get("tool_call")?.[0];
const startHandler = plugin?.handlers.get("before_agent_start")?.[0];
const contextHandler = plugin?.handlers.get("context")?.[0];
const toolResultHandler = plugin?.handlers.get("tool_result")?.[0];

assert.ok(toolHandler, "tool_call handler must be registered");
assert.ok(startHandler, "before_agent_start handler must be registered");
assert.ok(contextHandler, "context handler must be registered");
assert.ok(toolResultHandler, "tool_result handler must be registered");
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
  await toolHandler({
    toolName: "todo",
    toolCallId: "plan-draft-todo-1",
    input: { op: "init", items: ["Research code", "Draft solution", "Modify upstream OMP"] },
  }, context);

  assert.equal(notifications.length, 0, "No notifications during intermediate planning");

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
  assert.equal(dispatchedToCore, false, "Structurally invalid plan must never reach core dispatch");
  assert.equal(coreSelectedPlan, null, "Human review dialog must not open for invalid plan");

  // Phase 2c: Non-actionable plan (Approach without exact target, Verification without actionable proof)
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
  assert.equal(dispatchedToCore, false, "Non-actionable plan must never reach core dispatch");
  assert.equal(coreSelectedPlan, null, "Human review dialog must not open for non-actionable plan");

  // Phase 3: Structurally valid plan reaches native OMP review.
  const validatedFeatureContent = [
    "# Validated Feature Plan",
    "## Context",
    "Changes remain inside the plugin boundary.",
    "## Approach",
    "1. Update `src/extension.ts#createPlanProtectionForTest`.",
    "## Verification",
    "- `bun tests/e2e-real-plan-handoff.mjs` → native OMP review receives the validated proposal",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "validated-feature-plan.md"), validatedFeatureContent, "utf8");
  dispatchedToCore = false;
  coreSelectedPlan = null;
  const validatedResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-validated-call",
    input: { path: "xd://propose", content: "validated-feature" },
  }, context);
  assert.equal(validatedResult, undefined, "structurally valid plan must pass deterministic validation");
  const validatedCoreResult = await dispatchResolutionDevice(ompSession, "propose", "validated-feature");
  assert.equal(dispatchedToCore, true, "validated plan reaches native OMP review");
  assert.equal(validatedCoreResult.xdev.inner.planFilePath, "local://validated-feature-plan.md");
  assert.equal(coreSelectedPlan, "local://validated-feature-plan.md");
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

  assert.equal(allowedResult, undefined, "Clean UI plan proposal must be allowed to pass the guard");

  // Since guard allowed it, OMP resolution device receives the proposal
  const coreResult = await dispatchResolutionDevice(ompSession, "propose", "fixed-feature");
  assert.equal(dispatchedToCore, true, "Clean UI proposal successfully reaches OMP core dispatch");
  assert.equal(coreResult.xdev.inner.planFilePath, "local://fixed-feature-plan.md");
  assert.equal(coreSelectedPlan, "local://fixed-feature-plan.md", "Human review dialog opens with the approved plan!");

  // Phase 5: The deterministic per-turn budget blocks an excess proposal.
  dispatchedToCore = false;
  coreSelectedPlan = null;
  const repeatedResult = await toolHandler({
    toolName: "write",
    toolCallId: "propose-repeat-call",
    input: { path: "xd://propose", content: "fixed-feature" },
  }, context);

  assert.equal(repeatedResult?.block, true, "the fifth preflight-passed proposal must hit the turn budget");
  assert.match(repeatedResult.reason, /PLAN_VALIDATOR_TURN_BLOCKED/);
  assert.equal(dispatchedToCore, false, "an over-budget proposal must never reach core dispatch");

  // Phase 5b: ask tool_result resets turn budget and unblocks handoff to core
  toolResultHandler({ toolName: "ask", isError: false }, context);
  const unblockedResult = await toolHandler({
    toolName: "write",
    toolCallId: "ask-unblocked-call",
    input: { path: "xd://propose", content: "fixed-feature" },
  }, context);
  assert.equal(unblockedResult, undefined, "ask tool_result must reset turn budget and allow handoff to core");
  await dispatchResolutionDevice(ompSession, "propose", "fixed-feature");
  assert.equal(dispatchedToCore, true, "unblocked proposal must reach core dispatch");
  dispatchedToCore = false;
  coreSelectedPlan = null;

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

  assert.equal(refinedAllowed, undefined, "Refined proposal must pass validator and native OMP review after reset");

  const coreRefinedResult = await dispatchResolutionDevice(ompSession, "propose", "refined-feature");
  assert.equal(dispatchedToCore, true, "Refined proposal reaches OMP core dispatch");
  assert.equal(coreRefinedResult.xdev.inner.planFilePath, "local://refined-feature-plan.md");

  // Given an isolated session that entered Plan Mode,
  // When it proposes actionable Markdown without the injected core,
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
  const requiredMissing = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-missing",
    input: { path: "xd://propose", content: "required-missing" },
  }, requiredMissingContext);
  assert.equal(requiredMissing?.block, true, "activated session without a core must block");
  assert.match(requiredMissing.reason, /PLAN_CORE_REQUIRED/);

  // Given a second activated session,
  // When its leading core is malformed JSON,
  const requiredMalformedContext = await createIsolatedContext("required-malformed", true);
  const requiredMalformedContent = [
    "---",
    '{ "sections": { "context": "broken", } }',
    "---",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-malformed-plan.md"), requiredMalformedContent, "utf8");
  const requiredMalformed = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-malformed",
    input: { path: "xd://propose", content: "required-malformed" },
  }, requiredMalformedContext);
  assert.equal(requiredMalformed?.block, true, "malformed required core must block");
  assert.match(requiredMalformed.reason, /PLAN_CORE_INVALID/);

  // Given a third activated session,
  // When required core fields are empty,
  const requiredIncompleteContext = await createIsolatedContext("required-incomplete", true);
  const requiredIncompleteContent = [
    "---",
    JSON.stringify({ sections: { context: "", approach: [], verification: [] } }, null, 2),
    "---",
  ].join("\n");
  await fs.writeFile(path.join(localRoot, "required-incomplete-plan.md"), requiredIncompleteContent, "utf8");
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

  // Given a fourth activated session,
  // When it proposes a complete core,
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
  const requiredValid = await toolHandler({
    toolName: "write",
    toolCallId: "propose-required-valid",
    input: { path: "xd://propose", content: "required-valid" },
  }, requiredValidContext);
  assert.equal(requiredValid, undefined, "complete required core must pass the guard");
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
  const legacyCompatible = await toolHandler({
    toolName: "write",
    toolCallId: "propose-legacy-compatible",
    input: { path: "xd://propose", content: "legacy-compatible" },
  }, legacyContext);
  assert.equal(legacyCompatible, undefined, "legacy Markdown outside activated Plan Mode must stay allowed");

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-real-handoff-e2e@6",
    decision: "pass",
    scenarios: {
      zeroWasteOnIntermediateTodo: true,
      validatorBlockedInvalidStructure: true,
      validatorBlockedNonActionablePlan: true,
      cleanUIPlanApprovedAndDispatchedToCore: true,
      turnBudgetBlocksExcessProposal: true,
      refineResetsCycleAndDispatchesRefinedPlan: true,
      activatedSessionRequiresCore: true,
      validRequiredCoreReachesNativeReview: true,
      legacyMarkdownOutsideActivatedSession: true,
    },
    deterministicBlockReason: requiredMissing.reason,
    coreSelectedPlan,
  }, null, 2)}\n`);
} finally {
  await fs.rm(artifactsDir, { recursive: true, force: true });
}
