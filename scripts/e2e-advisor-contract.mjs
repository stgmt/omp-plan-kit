import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "1";
process.env.OMP_PLAN_ADVISOR_MAX_CALLS = "2";
process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS = "0";
process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS = "1000";
process.env.OMP_PLAN_ADVISOR_MAX_TOKENS = "160";

const home = os.homedir();
const installedExtension = path.join(home, ".omp", "plugins", "node_modules", "omp-plan-kit", "dist", "extension.js");
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadLegacyPiModule } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/plugins/legacy-pi-compat.ts")).href);
const { createPlanProtectionForTest } = await loadLegacyPiModule(installedExtension);
const requests = [];
const completeFake = async (model, request, options) => {
  requests.push({ model, request, options });
  return { content: [{ type: "text", text: "Verify the exact plan artifact." }], usage: { input_tokens: 80, output_tokens: 8 } };
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
  const badInput = { path: "xd://propose", content: "# Markdown plan with /private/path" };
  const blocked = await policy.handleToolCall({ toolName: "write", toolCallId: "invalid-1", input: badInput }, context);
  assert.equal(blocked?.block, true);
  assert.match(blocked.reason, /NON_SLUG_PAYLOAD/);
  await waitForRequests(1);

  const duplicate = await policy.handleToolCall({ toolName: "write", toolCallId: "invalid-2", input: badInput }, context);
  assert.equal(duplicate?.block, true);
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
  assert.equal(requests.length, 1, "the same violation signature must be deduplicated");

  await policy.handleAgentStart({ prompt: "Не нужен upstream OMP и authority ABI; работаем только в проекте." }, context);
  await policy.handleToolCall({ toolName: "todo", toolCallId: "todo-1", input: { op: "append", items: ["Add upstream OMP patch"] } }, context);
  await waitForRequests(2);

  await fs.mkdir(localRoot, { recursive: true });
  await fs.writeFile(path.join(localRoot, "new-plan.md"), "# New plan\n", "utf8");
  const allowed = await policy.handleToolCall({ toolName: "write", toolCallId: "valid", input: { path: "xd://propose", content: "new" } }, context);
  assert.equal(allowed, undefined, "exact slug/artifact must pass");
  for (let attempt = 0; attempt < 10; attempt += 1) await Promise.resolve();
  assert.equal(requests.length, 2, "normal proposal must not spend another advisor call");

  const requestShapes = requests.map(({ model, request, options }) => {
    const prompt = request.messages[0].content[0].text;
    assert.equal(options.maxTokens, 160);
    assert.equal(options.disableReasoning, true);
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(request.messages.length, 1);
    assert.ok(prompt.length < 1200);
    assert.ok(!prompt.includes("private/path"));
    return { provider: model.provider, model: model.id, maxTokens: options.maxTokens, disableReasoning: options.disableReasoning, promptChars: prompt.length };
  });

  process.stdout.write(`${JSON.stringify({
    schema: "omp-plan-kit-advisor-contract-e2e@3",
    decision: "pass",
    hardGuard: blocked.reason,
    triggers: ["invalid proposal", "explicit rejected-term todo"],
    deduplicatedRepeat: true,
    requestShapes,
    normalProposal: { guard: "allow", additionalAdvisorCalls: 0 },
  }, null, 2)}\n`);
} finally {
  await fs.rm(localRoot, { recursive: true, force: true });
}
