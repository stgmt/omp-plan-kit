// @bun
// src/extension.ts
import crypto from "crypto";
import * as fs from "fs/promises";
import os from "os";
import path from "path";
import { complete } from "@oh-my-pi/pi-ai";
var PROPOSE_PATH = "xd://propose";
var PLAN_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/u;
var LOCAL_ROOT = path.join(os.tmpdir(), "omp-local");
var WINDOWS_LOCAL_ROOT_MAX_CHARS = 180;
var RECEIPT_PATH = path.join(os.homedir(), ".omp", "agent", "omp-plan-kit-receipts.ndjson");
var MAX_ADVISOR_CALLS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_CALLS, 3, 0, 10);
var ADVISOR_COOLDOWN_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_COOLDOWN_MS, 0, 0, 86400000);
var ADVISOR_TIMEOUT_MS = boundedNumber(process.env.OMP_PLAN_ADVISOR_TIMEOUT_MS, 15000, 500, 60000);
var ADVISOR_MAX_TOKENS = boundedNumber(process.env.OMP_PLAN_ADVISOR_MAX_TOKENS, 160, 32, 256);
var ADVISOR_MAX_OUTPUT_CHARS = 600;
var activeTestDependencies = {};
function setTestDependencies(deps) {
  activeTestDependencies = deps;
}
function boundedNumber(raw, fallback, min, max) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}
function stateFor(states, sessionId) {
  const existing = states.get(sessionId);
  if (existing)
    return existing;
  const created = { userPrompt: "", calls: 0, lastCallAt: 0, cache: new Map };
  states.set(sessionId, created);
  return created;
}
function redact(value, maxChars) {
  const stringified = String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, maxChars);
  return stringified.replace(/\b(?:ghp|github_pat)_[A-Za-z0-9_]+\b/giu, "[REDACTED]").replace(/\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\s*[:=]\s*[^\s]+/giu, "$1=[REDACTED]");
}
function parseSlug(payload) {
  if (typeof payload !== "string" || payload.trim() !== payload || !PLAN_SLUG_RE.test(payload))
    return null;
  const slug = payload.replace(/-plan$/iu, "") || payload;
  return { slug, planUrl: `local://${slug}-plan.md` };
}
function safeSessionId(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9_.-]/gu, "_") || "session";
}
function resolveLocalRoot(sessionId, options) {
  const artifactsDir = options?.getArtifactsDir?.();
  if (artifactsDir) {
    const candidate = path.resolve(artifactsDir, "local");
    if (process.platform === "win32" && candidate.length >= WINDOWS_LOCAL_ROOT_MAX_CHARS) {
      return path.resolve(LOCAL_ROOT, safeSessionId(sessionId));
    }
    return candidate;
  }
  return path.resolve(LOCAL_ROOT, safeSessionId(sessionId));
}
function localPlanPath(planUrl, sessionId, options) {
  if (!planUrl.startsWith("local://"))
    return null;
  const relative = planUrl.slice("local://".length).replace(/[\\/]+/gu, path.sep);
  if (!relative || relative.includes(`..${path.sep}`) || path.isAbsolute(relative))
    return null;
  const root = resolveLocalRoot(sessionId, options);
  const candidate = path.resolve(root, relative);
  const rel = path.relative(root, candidate);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    return null;
  return candidate;
}
async function preflightProposal(payload, sessionId, options) {
  const parsed = parseSlug(payload);
  if (!parsed) {
    return { ok: false, code: "NON_SLUG_PAYLOAD", reason: "xd://propose accepts one plan slug; full Markdown is rejected before dispatch" };
  }
  if (!sessionId)
    return { ok: false, code: "SESSION_ID_MISSING", reason: "cannot bind proposal to an OMP session" };
  const planPath = localPlanPath(parsed.planUrl, sessionId, options);
  if (!planPath)
    return { ok: false, code: "PLAN_PATH_UNSAFE", reason: `refused unsafe plan path ${parsed.planUrl}` };
  try {
    const stat2 = await fs.stat(planPath);
    if (!stat2.isFile())
      return { ok: false, code: "PLAN_FILE_NOT_REGULAR", reason: `plan artifact is not a regular file: ${parsed.planUrl}` };
    const bytes = await fs.readFile(planPath);
    return { ok: true, ...parsed, planPath, bytes: bytes.byteLength, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return { ok: false, code: "PLAN_FILE_MISSING", reason: `exact plan artifact is missing: ${parsed.planUrl}; fallback is disabled` };
  }
}
async function writeReceipt(data) {
  try {
    await fs.mkdir(path.dirname(RECEIPT_PATH), { recursive: true });
    await fs.appendFile(RECEIPT_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...data })}
`, "utf8");
  } catch {}
}
function resolveAdvisorModel(ctx) {
  const spec = process.env.OMP_PLAN_ADVISOR_MODEL?.trim() || "@advisor";
  return ctx.models.resolve(spec) ?? ctx.models.current();
}
async function reviewProposedPlan(ctx, state, check, planContent, completeImpl) {
  const sessionId = ctx.sessionManager.getSessionId();
  const enabled = (process.env.OMP_PLAN_ADVISOR ?? "1").toLowerCase() !== "0";
  const cached = state.cache.get(check.sha256);
  if (cached) {
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: cached.verdict, source: "cache" });
    return cached;
  }
  if (!enabled || MAX_ADVISOR_CALLS === 0) {
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: "APPROVE", source: "advisor-disabled" });
    return { verdict: "APPROVE", reason: "Advisor disabled; plan allowed by default." };
  }
  const now = Date.now();
  if (state.calls >= MAX_ADVISOR_CALLS || ADVISOR_COOLDOWN_MS > 0 && now - state.lastCallAt < ADVISOR_COOLDOWN_MS) {
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: "APPROVE", source: "budget-suppressed" });
    return { verdict: "APPROVE", reason: "Advisor call budget reached; handoff permitted." };
  }
  const model = resolveAdvisorModel(ctx);
  if (!model) {
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: "APPROVE", source: "model-unavailable" });
    return { verdict: "APPROVE", reason: "Advisor model unavailable; handoff permitted." };
  }
  const apiKey = await ctx.modelRegistry.getApiKey(model);
  if (!apiKey) {
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: "APPROVE", source: "credential-unavailable" });
    return { verdict: "APPROVE", reason: "Advisor credential unavailable; handoff permitted." };
  }
  state.calls += 1;
  state.lastCallAt = now;
  const boundedPrompt = redact(state.userPrompt, 600);
  const boundedPlan = redact(planContent, 1200);
  const promptText = [
    "You are the OMP Plan Advisor reviewing a proposed plan at the exit of plan mode.",
    "Evaluate whether this plan is viable, safe, and ready to hand off for execution.",
    `User Objective / Constraints: ${boundedPrompt || "None specified"}`,
    `Plan Artifact: ${check.planUrl}`,
    "Plan Excerpt:",
    boundedPlan,
    "",
    "Rules:",
    "1. If the plan introduces forbidden changes, violates constraints, or lacks concrete steps, respond with:",
    "REJECT: <clear explanation of what must be fixed in the plan, max 40 words>",
    "2. If the plan is sound, safe, and ready for operator approval, respond with:",
    "APPROVE: <brief confirmation, max 30 words>"
  ].join(`
`);
  try {
    const response = await completeImpl(model, {
      messages: [{ role: "user", content: [{ type: "text", text: promptText }], timestamp: Date.now() }]
    }, {
      apiKey,
      maxTokens: ADVISOR_MAX_TOKENS,
      disableReasoning: true,
      signal: AbortSignal.timeout(ADVISOR_TIMEOUT_MS)
    });
    const rawText = response.content.filter((block) => block.type === "text").map((block) => block.text).join(" ").trim().slice(0, ADVISOR_MAX_OUTPUT_CHARS);
    let verdict = "APPROVE";
    let reason = rawText;
    if (/^REJECT\b/iu.test(rawText) || /\u043E\u0442\u043A\u043B\u043E\u043D\w*/iu.test(rawText) || /\u0437\u0430\u043F\u0440\u0435\u0449\w*/iu.test(rawText)) {
      verdict = "REJECT";
      reason = rawText.replace(/^REJECT:\s*/iu, "").trim() || rawText;
    } else if (/^APPROVE\b/iu.test(rawText)) {
      verdict = "APPROVE";
      reason = rawText.replace(/^APPROVE:\s*/iu, "").trim() || rawText;
    }
    const result = { verdict, reason };
    state.cache.set(check.sha256, result);
    const usageObj = typeof response.usage === "object" && response.usage !== null ? response.usage : undefined;
    await writeReceipt({
      sessionId,
      slug: check.slug,
      sha256: check.sha256,
      verdict,
      reason,
      provider: model.provider,
      model: model.id,
      usage: usageObj
    });
    if (ctx.hasUI) {
      ctx.ui.notify(`Plan advisor [${verdict}]: ${reason}`, verdict === "REJECT" ? "warning" : "info");
    }
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await writeReceipt({ sessionId, slug: check.slug, sha256: check.sha256, verdict: "APPROVE", source: "advisor-failed", error: errorMsg });
    return { verdict: "APPROVE", reason: `Advisor call failed: ${errorMsg}` };
  }
}
function createPlanProtectionForTest(dependencies = {}) {
  const states = new Map;
  return {
    async handleToolCall(event, ctx) {
      const completeImpl = dependencies.complete ?? activeTestDependencies.complete ?? complete;
      const sessionId = ctx.sessionManager.getSessionId();
      const state = stateFor(states, sessionId);
      if (event.toolName === "write" && event.input?.path === PROPOSE_PATH) {
        const check = await preflightProposal(event.input.content, sessionId, ctx.localProtocolOptions);
        if (!check.ok) {
          return { block: true, reason: `[PLAN_HANDOFF_${check.code}] ${check.reason}` };
        }
        const planContent = await fs.readFile(check.planPath, "utf8");
        const review = await reviewProposedPlan(ctx, state, check, planContent, completeImpl);
        if (review.verdict === "REJECT") {
          return {
            block: true,
            reason: `[PLAN_ADVISOR_BLOCK] \u0421\u043E\u0432\u0435\u0442\u043D\u0438\u043A \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043F\u043B\u0430\u043D: ${review.reason}`
          };
        }
        writeReceipt({ sessionId, kind: "proposal-approved", slug: check.slug, sha256: check.sha256 }).catch(() => {
          return;
        });
        return;
      }
      return;
    },
    async handleAgentStart(event, ctx) {
      stateFor(states, ctx.sessionManager.getSessionId()).userPrompt = event.prompt ?? "";
    }
  };
}
function planProtection(pi) {
  pi.setLabel("OMP Plan Kit");
  const policy = createPlanProtectionForTest();
  pi.on("before_agent_start", async (event, ctx) => policy.handleAgentStart(event, ctx));
  pi.on("tool_call", async (event, ctx) => policy.handleToolCall(event, ctx));
}
export {
  setTestDependencies,
  planProtection as default,
  createPlanProtectionForTest
};
