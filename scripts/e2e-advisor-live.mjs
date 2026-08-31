import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "1";
process.env.OMP_PLAN_ADVISOR_MAX_CALLS = "1";
process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS = "0";
process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS = "10000";
process.env.OMP_PLAN_ADVISOR_MAX_TOKENS = "160";

const home = os.homedir();
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const installedExtension = path.join(home, ".omp", "plugins", "node_modules", "omp-plan-kit", "dist", "extension.js");
const { loadExtensions } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href);
const { discoverAuthStorage } = await import(pathToFileURL(path.join(ompRoot, "src/sdk.ts")).href);
const { ModelRegistry } = await import(pathToFileURL(path.join(ompRoot, "src/config/model-registry.ts")).href);

const loaded = await loadExtensions([installedExtension], process.cwd());
assert.deepEqual(loaded.errors, [], `OMP loader must import the linked plugin: ${JSON.stringify(loaded.errors)}`);
const toolHandler = loaded.extensions[0]?.handlers.get("tool_call")?.[0];
assert.equal(typeof toolHandler, "function", "linked plugin must register its tool_call handler");

const authStorage = await discoverAuthStorage();
const registry = new ModelRegistry(authStorage);
const model = registry.getAvailable().find((candidate) => candidate.provider === "openai-codex" && candidate.id === "gpt-5.6-sol") ?? registry.getAvailable()[0];
assert.ok(model, "OMP must expose at least one authenticated model for live advisor E2E");
const apiKey = await registry.getApiKey(model);
assert.ok(apiKey, `OMP must resolve an API key for ${model.provider}/${model.id}`);

const notifications = [];
let resolveNotification;
const notification = new Promise((resolve) => { resolveNotification = resolve; });
const sessionId = `standalone-advisor-live-${process.pid}-${Date.now()}`;
const context = {
  sessionManager: { getSessionId: () => sessionId },
  hasUI: true,
  ui: { notify(message, level) { notifications.push({ message, level }); resolveNotification({ message, level }); } },
  models: { resolve() { return model; }, current() { return model; } },
  modelRegistry: registry,
};

const blocked = await toolHandler(
  { toolName: "write", toolCallId: "live-advisor", input: { path: "xd://propose", content: "# Markdown plan with /path" } },
  context,
);
assert.equal(blocked?.block, true);
assert.match(blocked.reason, /NON_SLUG_PAYLOAD/);
const delivered = await Promise.race([
  notification,
  new Promise((_, reject) => setTimeout(() => reject(new Error("native OMP advisor did not return a UI advisory within 15s")), 15_000)),
]);
assert.ok(delivered.message.length > 0);

process.stdout.write(`${JSON.stringify({
  schema: "omp-plan-kit-advisor-live-e2e@3",
  decision: "pass",
  model: { provider: model.provider, id: model.id },
  hardGuard: blocked.reason,
  advisory: { notifications: notifications.length, outputChars: delivered.message.length, level: delivered.level, maxTokens: 160, reasoning: "disabled" },
  loader: "OMP loadExtensions",
}, null, 2)}\n`);
