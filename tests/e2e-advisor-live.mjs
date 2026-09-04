import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "1";
process.env.OMP_PLAN_ADVISOR_MAX_CALLS = "5";
process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS = "0";
process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS = "15000";
process.env.OMP_PLAN_ADVISOR_MAX_TOKENS = "160";

const home = os.homedir();
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const installedExtension = path.join(process.cwd(), "dist", "extension.js");
const { loadExtensions } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href);
const { discoverAuthStorage } = await import(pathToFileURL(path.join(ompRoot, "src/sdk.ts")).href);
const { ModelRegistry } = await import(pathToFileURL(path.join(ompRoot, "src/config/model-registry.ts")).href);

const loaded = await loadExtensions([installedExtension], process.cwd());
assert.deepEqual(loaded.errors, [], `OMP loader must import the linked plugin: ${JSON.stringify(loaded.errors)}`);
const plugin = loaded.extensions[0];
const toolHandler = plugin?.handlers.get("tool_call")?.[0];
const startHandler = plugin?.handlers.get("before_agent_start")?.[0];
assert.equal(typeof toolHandler, "function", "linked plugin must register its tool_call handler");
assert.equal(typeof startHandler, "function", "linked plugin must register its before_agent_start handler");

const authStorage = await discoverAuthStorage();
const registry = new ModelRegistry(authStorage);
const model = registry.getAvailable().find((candidate) => candidate.provider === "openai-codex" && candidate.id === "gpt-5.6-sol") ?? registry.getAvailable()[0];
assert.ok(model, "OMP must expose at least one authenticated model for live advisor E2E");
const apiKey = await registry.getApiKey(model);
assert.ok(apiKey, `OMP must resolve an API key for ${model.provider}/${model.id}`);

const notifications = [];
const sessionId = `standalone-advisor-live-${process.pid}-${Date.now()}`;
const localRoot = path.join(os.tmpdir(), "omp-local", sessionId);
await fs.mkdir(localRoot, { recursive: true });

const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: true,
  ui: {
    notify(message, level) {
      notifications.push({ message, level, timestamp: Date.now() });
    },
  },
  models: { resolve() { return model; }, current() { return model; } },
  modelRegistry: registry,
};

try {
  // Step 1: Agent receives prompt with negative scope
  await startHandler({ prompt: "Не надо трогать upstream OMP и authority ABI; работаем строго в границах проекта." }, context);

  // Step 2: Intermediate todo updates MUST NOT trigger the advisor (Zero tokens wasted!)
  const initialNotifCount = notifications.length;
  await toolHandler(
    { toolName: "todo", toolCallId: "todo-step", input: { op: "append", items: ["Touch upstream OMP"] } },
    context,
  );
  assert.equal(notifications.length, initialNotifCount, "Intermediate todo operations must never trigger the advisor");

  // Step 3: Write defective plan artifact to disk (structurally valid, but violates negative scope)
  const badPlanContent = [
    "# Bad Feature Plan",
    "## Context",
    "Modify upstream OMP authority interfaces and core runtime.",
    "## Approach",
    "1. Edit upstream OMP source in `src/extensibility/authority.ts`.",
    "## Verification",
    "- `bun test` → exit code 0",
  ].join("\n");
  await fs.writeFile(
    path.join(localRoot, "bad-feature-plan.md"),
    badPlanContent,
    "utf8",
  );

  // Step 4: Propose the defective plan -> Plan Advisor runs with live model and BLOCKS the handoff
  const blockedProposal = await toolHandler(
    { toolName: "write", toolCallId: "propose-bad-feature", input: { path: "xd://propose", content: "bad-feature" } },
    context,
  );
  assert.equal(blockedProposal?.block, true, "Plan Advisor must block the defective proposal");
  assert.match(blockedProposal.reason, /\[PLAN_ADVISOR_BLOCK\]/, "Reason must begin with [PLAN_ADVISOR_BLOCK]");
  assert.ok(notifications.length > initialNotifCount, "Plan Advisor must emit a live UI notification with its critique");
  const rejectNotification = notifications[notifications.length - 1];

  // Step 5: Write a sound, concrete clean plan artifact with complete contract and propose it -> live advisor APPROVES
  const notifCountBeforeClean = notifications.length;
  const cleanPlanContent = [
    "# Clean Feature Plan",
    "## Context",
    "Implement local formatting helpers strictly within this project repository. Zero changes to upstream OMP or authority ABI.",
    "## Approach",
    "1. Contract: `formatNumber()` in `src/utils.ts`. Formats numbers with comma thousands separator (1234.5 -> '1,234.50'). Handle 0, negative values, and decimals in `src/utils.ts`.",
    "2. Add unit tests in `tests/utils.test.ts` covering edge cases (0, negative, decimals).",
    "## Verification",
    "- `bun test` → confirm 100% assertions pass",
  ].join("\n");
  await fs.writeFile(
    path.join(localRoot, "clean-feature-plan.md"),
    cleanPlanContent,
    "utf8",
  );
  const allowedProposal = await toolHandler(
    { toolName: "write", toolCallId: "propose-clean-feature", input: { path: "xd://propose", content: "clean-feature" } },
    context,
  );
  assert.equal(allowedProposal, undefined, "Clean concrete plan must pass after live advisor approval");
  assert.ok(notifications.length > notifCountBeforeClean, "Plan Advisor must emit an approval notification for clean plan");
  const approveNotification = notifications[notifications.length - 1];

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-advisor-live-e2e@5",
    decision: "pass",
    model: { provider: model.provider, id: model.id },
    features: {
      zeroWasteOnTodo: true,
      liveAdvisorRanOnBadPlan: true,
      liveAdvisorBlockedBadPlan: true,
      liveAdvisorRanOnCleanPlan: true,
      liveAdvisorApprovedCleanPlan: true,
    },
    planAdvisorBlockReason: blockedProposal.reason,
    rejectAdvisory: rejectNotification?.message,
    approveAdvisory: approveNotification?.message,
    loader: "OMP loadExtensions",
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
