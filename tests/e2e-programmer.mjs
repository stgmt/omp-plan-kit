import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.OMP_PLAN_ADVISOR = "0";
const home = os.homedir();
const defaultAgentDir = path.join(home, ".omp", "agent");
const profilesDir = path.join(home, ".omp", "profiles");
const installedExtension = path.join(path.dirname(defaultAgentDir), "plugins", "node_modules", "omp-plan-kit", "dist", "extension.js");
const ompRoot = process.env.OMP_CODING_AGENT_ROOT ?? path.join(home, ".omp", "plugins", "node_modules", "@oh-my-pi", "pi-coding-agent");
const { loadExtensions } = await import(pathToFileURL(path.join(ompRoot, "src/extensibility/extensions/loader.ts")).href);
const { dispatchResolutionDevice } = await import(pathToFileURL(path.join(ompRoot, "src/tools/resolve.ts")).href);
const { resolveApprovedPlan } = await import(pathToFileURL(path.join(ompRoot, "src/plan-mode/approved-plan.ts")).href);

async function profileAgentDirs() {
  const roots = [defaultAgentDir];
  try {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    for (const entry of entries) if (entry.isDirectory()) roots.push(path.join(profilesDir, entry.name, "agent"));
  } catch {
    // Default profile only.
  }
  return [...new Set(roots)];
}

async function readPlan(localRoot, planUrl) {
  const relative = planUrl.replace(/^local:\/\//u, "");
  try {
    return await fs.readFile(path.join(localRoot, relative), "utf8");
  } catch {
    return null;
  }
}

async function listPlanFiles(localRoot) {
  const entries = await fs.readdir(localRoot, { withFileTypes: true });
  const plans = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/plan\.md$/iu.test(entry.name)) continue;
    const stat = await fs.stat(path.join(localRoot, entry.name));
    plans.push({ url: `local://${entry.name}`, mtime: stat.mtimeMs });
  }
  return plans.sort((left, right) => right.mtime - left.mtime).map((plan) => plan.url);
}

function makeSession(localRoot, sessionId) {
  return {
    peekPlanProposalHandler: () => async (title) => {
      const resolved = await resolveApprovedPlan({
        suppliedTitle: title,
        statePlanFilePath: "local://old-plan.md",
        readPlan: (planUrl) => readPlan(localRoot, planUrl),
        listPlanFiles: () => listPlanFiles(localRoot),
      });
      return { content: [{ type: "text", text: resolved.planFilePath }], details: { planFilePath: resolved.planFilePath, title: resolved.title, planExists: true, sessionId } };
    },
  };
}

async function main() {
  const roots = await profileAgentDirs();
  const discovery = [];
  for (const agentDir of roots) {
    const pluginDir = path.join(path.dirname(agentDir), "plugins", "node_modules", "omp-plan-kit");
    try {
      await fs.stat(path.join(pluginDir, "package.json"));
    } catch {
      continue;
    }
    const manifest = JSON.parse(await fs.readFile(path.join(pluginDir, "package.json"), "utf8"));
    const extension = path.join(pluginDir, "dist", "extension.js");
    await fs.stat(extension);
    assert.equal(manifest.name, "omp-plan-kit");
    assert.deepEqual(manifest.omp?.extensions, ["./dist/extension.js"]);
    const loadedProfile = await loadExtensions([extension], process.cwd());
    assert.deepEqual(loadedProfile.errors, [], `OMP loader must import ${extension}: ${JSON.stringify(loadedProfile.errors)}`);
    assert.equal(loadedProfile.extensions[0]?.handlers.get("tool_call")?.length, 1);
    discovery.push({ agentDir, pluginDir, extension, manifest: "valid", loader: "pass" });
  }

  const loaded = await loadExtensions([installedExtension], process.cwd());
  assert.deepEqual(loaded.errors, [], `OMP loader must import the linked plugin: ${JSON.stringify(loaded.errors)}`);
  const plugin = loaded.extensions[0];
  assert.ok(plugin, "OMP loader must return the linked plugin extension");
  const handlers = plugin.handlers.get("tool_call") ?? [];
  assert.equal(handlers.length, 1, "plugin must register one ordered tool_call gate");
  const sessionId = `standalone-programmer-e2e-${process.pid}-${Date.now()}`;
  const artifactsDir = path.join(os.tmpdir(), `omp-plan-artifacts-${process.pid}-${Date.now()}`);
  const localRoot = path.join(artifactsDir, "local");
  const context = {
    sessionManager: { getSessionId: () => sessionId },
    localProtocolOptions: { getArtifactsDir: () => artifactsDir, getSessionId: () => sessionId },
    hasUI: false,
    ui: { notify() {} },
  };
  await fs.mkdir(localRoot, { recursive: true });

  try {
    await fs.writeFile(path.join(localRoot, "old-plan.md"), "# Old\nOLD_PLAN_MARKER\n", "utf8");
    const mutationCases = [
      { name: "full-markdown", content: "# Plan: new plan\n\nStep: use a/path", code: "NON_SLUG_PAYLOAD" },
      { name: "empty", content: "", code: "NON_SLUG_PAYLOAD" },
      { name: "trailing-whitespace", content: "new ", code: "NON_SLUG_PAYLOAD" },
      { name: "leading-whitespace", content: " new", code: "NON_SLUG_PAYLOAD" },
      { name: "surrounding-whitespace", content: " new ", code: "NON_SLUG_PAYLOAD" },
      { name: "path-traversal", content: "../old", code: "NON_SLUG_PAYLOAD" },
      { name: "missing-exact-artifact", content: "missing", code: "PLAN_FILE_MISSING" },
    ];
    const mutations = [];
    for (const testCase of mutationCases) {
      const result = await handlers[0]({ toolName: "write", toolCallId: testCase.name, input: { path: "xd://propose", content: testCase.content } }, context);
      assert.equal(result?.block, true, `${testCase.name} must block`);
      assert.match(result.reason, new RegExp(testCase.code));
      mutations.push({ name: testCase.name, decision: "block", code: testCase.code });
    }

    const unrelated = await handlers[0]({ toolName: "write", toolCallId: "unrelated", input: { path: "notes.md", content: "ordinary write" } }, context);
    assert.equal(unrelated, undefined, "unrelated writes must not be intercepted");
    mutations.push({ name: "unrelated-write", decision: "allow" });

    const badBody = mutationCases[0].content;
    const unguarded = await dispatchResolutionDevice(makeSession(localRoot, sessionId), "propose", badBody);
    assert.equal(unguarded.xdev.inner.planFilePath, "local://old-plan.md", "unprotected OMP path selected the stale plan");

    const validNewPlan = [
      "## Context",
      "New plan context description.",
      "## Approach",
      "NEW_PLAN_MARKER: Implementation details.",
      "## Verification",
      "Verification commands.",
    ].join("\n");
    await fs.writeFile(path.join(localRoot, "new-plan.md"), validNewPlan, "utf8");
    const allowed = await handlers[0]({ toolName: "write", toolCallId: "good", input: { path: "xd://propose", content: "new" } }, context);
    assert.equal(allowed, undefined, "exact slug with exact artifact must pass");
    const guarded = await dispatchResolutionDevice(makeSession(localRoot, sessionId), "propose", "new");
    assert.equal(guarded.xdev.inner.planFilePath, "local://new-plan.md", "valid slug must resolve the exact plan");
    mutations.push({ name: "exact-slug", decision: "allow", selected: guarded.xdev.inner.planFilePath });

    await fs.rm(path.join(localRoot, "new-plan.md"));
    const afterDelete = await handlers[0]({ toolName: "write", toolCallId: "deleted", input: { path: "xd://propose", content: "new" } }, context);
    assert.equal(afterDelete?.block, true, "deleted exact artifact must block even when an old plan remains");
    assert.match(afterDelete.reason, /PLAN_FILE_MISSING/);
    mutations.push({ name: "exact-artifact-deleted-with-old-plan-present", decision: "block", code: "PLAN_FILE_MISSING" });

    process.stdout.write(`${JSON.stringify({
      schema: "omp-plan-kit-programmer-e2e@2",
      decision: "pass",
      ompRoot,
      discovery,
      unguardedCoreSelected: unguarded.xdev.inner.planFilePath,
      mutations,
      guardedCoreSelected: guarded.xdev.inner.planFilePath,
    }, null, 2)}\n`);
  } finally {
    await fs.rm(artifactsDir, { recursive: true, force: true });
  }
}

await main();
