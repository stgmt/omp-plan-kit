// @bun
// src/extension.ts
import crypto from "crypto";
import * as fs from "fs/promises";
import os from "os";
import path from "path";
import { complete } from "@oh-my-pi/pi-ai";

// src/plan-validator.ts
var CANONICAL_SECTIONS = [
  "Context",
  "Approach",
  "Critical files & anchors",
  "Verification",
  "Assumptions & contingencies"
];
var REQUIRED_SECTIONS = [
  "Context",
  "Approach",
  "Verification"
];
function isTargetToken(raw) {
  const token = raw.trim();
  if (!token)
    return false;
  if (token.includes("/") || token.includes("\\") || token.includes("#") || token.includes("::")) {
    return true;
  }
  if (/[\p{L}\p{N}_$-]+\s*>\s*[\p{L}\p{N}_$-]+/u.test(token)) {
    return true;
  }
  if (/^[\p{L}_$][\p{L}\p{N}_$]*\s*\(.*\)$/u.test(token)) {
    return true;
  }
  if (/[\p{L}\p{N}_$-]+\.[\p{L}\p{N}_$-]+/u.test(token)) {
    return true;
  }
  return false;
}
function extractInlineCodeTokens(line) {
  const tokens = [];
  const regex = /`([^`\r\n]+)`/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}
function stepHasTarget(stepLines) {
  for (const line of stepLines) {
    const tokens = extractInlineCodeTokens(line);
    for (const token of tokens) {
      if (isTargetToken(token)) {
        return true;
      }
    }
  }
  return false;
}
function getApproachSteps(lines, primaryLine, endIndex, lineFenceState) {
  const startIdx = primaryLine;
  const endIdx = endIndex;
  const h3Indices = [];
  for (let idx = startIdx;idx < endIdx; idx++) {
    if (lineFenceState[idx])
      continue;
    if (/^###\s+(.*?)\s*$/.test(lines[idx])) {
      h3Indices.push(idx);
    }
  }
  if (h3Indices.length > 0) {
    return h3Indices.map((idx, i) => {
      const nextIdx = i + 1 < h3Indices.length ? h3Indices[i + 1] : endIdx;
      const stepLines = [];
      for (let j = idx;j < nextIdx; j++) {
        if (!lineFenceState[j]) {
          stepLines.push(lines[j]);
        }
      }
      return {
        line: idx + 1,
        lines: stepLines
      };
    });
  }
  const numIndices = [];
  for (let idx = startIdx;idx < endIdx; idx++) {
    if (lineFenceState[idx])
      continue;
    if (/^(\d+\.|\d+\))\s+(.*)$/.test(lines[idx])) {
      numIndices.push(idx);
    }
  }
  if (numIndices.length > 0) {
    return numIndices.map((idx, i) => {
      const nextIdx = i + 1 < numIndices.length ? numIndices[i + 1] : endIdx;
      const stepLines = [];
      for (let j = idx;j < nextIdx; j++) {
        if (!lineFenceState[j]) {
          stepLines.push(lines[j]);
        }
      }
      return {
        line: idx + 1,
        lines: stepLines
      };
    });
  }
  const stepLines = [];
  for (let j = startIdx;j < endIdx; j++) {
    if (!lineFenceState[j]) {
      stepLines.push(lines[j]);
    }
  }
  return [
    {
      line: primaryLine,
      lines: stepLines
    }
  ];
}
function isVerificationActionable(lines, primaryLine, endIndex, lineFenceState) {
  const startIdx = primaryLine;
  const endIdx = endIndex;
  for (let idx = startIdx;idx < endIdx; idx++) {
    if (lineFenceState[idx])
      continue;
    const line = lines[idx];
    const match = line.match(/`([^`\r\n]+)`\s*(?:\u2192|=>|->)\s*(\S.*)$/u);
    if (match) {
      const action = match[1].trim();
      const expected = match[2].trim();
      if (action.length > 0 && expected.length > 0) {
        return true;
      }
    }
  }
  for (let idx = startIdx;idx < endIdx; idx++) {
    const line = lines[idx];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[2][0];
      const len = fenceMatch[2].length;
      let closeIdx = -1;
      let hasBlockContent = false;
      for (let j = idx + 1;j < endIdx; j++) {
        const innerLine = lines[j];
        const innerFence = innerLine.match(/^(\s*)(`{3,}|~{3,})/);
        if (innerFence && innerFence[2][0] === char && innerFence[2].length >= len) {
          closeIdx = j;
          break;
        }
        if (innerLine.trim().length > 0) {
          hasBlockContent = true;
        }
      }
      if (closeIdx !== -1 && hasBlockContent) {
        for (let k = closeIdx + 1;k < endIdx; k++) {
          const nextLine = lines[k].trim();
          if (nextLine.length === 0)
            continue;
          const expMatch = nextLine.match(/^(?:[-*]\s+|\d+[.)]\s+)?(?:Expected|\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F|\u041E\u0436\u0438\u0434\u0430\u0435\u043C\u043E):\s*(\S.*)$/iu);
          if (expMatch && expMatch[1].trim().length > 0) {
            return true;
          }
          break;
        }
        idx = closeIdx;
      }
    }
  }
  return false;
}
function validatePlanStructure(markdown) {
  if (!markdown || markdown.trim().length === 0) {
    return [
      {
        code: "PLAN_EMPTY",
        line: 1,
        message: "Plan file is empty",
        fix: "Write a complete plan with Context, Approach, and Verification sections."
      }
    ];
  }
  const lines = markdown.split(/\r?\n/);
  const issues = [];
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  const lineFenceState = new Array(lines.length).fill(false);
  const headings = [];
  for (let i = 0;i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[2][0];
      const len = fenceMatch[2].length;
      if (!inFence) {
        inFence = true;
        fenceChar = char;
        fenceLen = len;
        lineFenceState[i] = true;
        continue;
      } else if (char === fenceChar && len >= fenceLen) {
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
        lineFenceState[i] = true;
        continue;
      }
    }
    if (inFence) {
      lineFenceState[i] = true;
      continue;
    }
    const headingMatch = line.match(/^##\s+(.*?)\s*$/);
    if (headingMatch) {
      const title = headingMatch[1].trim();
      const matchedSection = CANONICAL_SECTIONS.find((s) => s === title);
      if (matchedSection) {
        headings.push({ section: matchedSection, line: i + 1 });
      }
    }
  }
  const occurrencesBySection = new Map;
  for (const s of CANONICAL_SECTIONS) {
    occurrencesBySection.set(s, []);
  }
  for (const h of headings) {
    occurrencesBySection.get(h.section).push(h);
  }
  for (const req of REQUIRED_SECTIONS) {
    const occurrences = occurrencesBySection.get(req);
    if (occurrences.length === 0) {
      issues.push({
        code: "SECTION_MISSING",
        section: req,
        message: `Required section "${req}" is missing`,
        fix: `Add a section whose heading line is exactly "## ${req}" (English literal; translations, bilingual, or decorated headings are not matched).`
      });
    }
  }
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length > 1) {
      for (let i = 1;i < occurrences.length; i++) {
        const extra = occurrences[i];
        issues.push({
          code: "SECTION_DUPLICATE",
          section,
          line: extra.line,
          message: `Duplicate section "${section}" at line ${extra.line}`,
          fix: `Remove duplicate "## ${section}" heading and consolidate content under the primary section at line ${occurrences[0].line}.`
        });
      }
    }
  }
  const emptySections = new Set;
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length === 0) {
      continue;
    }
    const primary = occurrences[0];
    const startIndex = primary.line;
    let nextHeadingLine = lines.length + 1;
    for (const h of headings) {
      if (h.line > primary.line && h.line < nextHeadingLine) {
        nextHeadingLine = h.line;
      }
    }
    const endIndex = nextHeadingLine - 1;
    let hasContent = false;
    for (let idx = startIndex;idx < endIndex; idx++) {
      if (lines[idx].trim().length > 0) {
        hasContent = true;
        break;
      }
    }
    if (!hasContent) {
      emptySections.add(section);
      issues.push({
        code: "SECTION_EMPTY",
        section,
        line: primary.line,
        message: `Section "${section}" at line ${primary.line} is empty`,
        fix: `Add content to "## ${section}".`
      });
    }
  }
  const approachOccurrences = occurrencesBySection.get("Approach");
  if (approachOccurrences.length === 1 && !emptySections.has("Approach")) {
    const primary = approachOccurrences[0];
    let nextHeadingLine = lines.length + 1;
    for (const h of headings) {
      if (h.line > primary.line && h.line < nextHeadingLine) {
        nextHeadingLine = h.line;
      }
    }
    const endIdx = nextHeadingLine - 1;
    const steps = getApproachSteps(lines, primary.line, endIdx, lineFenceState);
    for (const step of steps) {
      if (!stepHasTarget(step.lines)) {
        issues.push({
          code: "APPROACH_TARGET_MISSING",
          section: "Approach",
          line: step.line,
          message: `Approach step at line ${step.line} has no exact target`,
          fix: "Add an exact target using inline code, e.g. `src/file.ts#symbol`, `GET /api/orders`, `Settings > Billing`."
        });
      }
    }
  }
  const verificationOccurrences = occurrencesBySection.get("Verification");
  if (verificationOccurrences.length === 1 && !emptySections.has("Verification")) {
    const primary = verificationOccurrences[0];
    let nextHeadingLine = lines.length + 1;
    for (const h of headings) {
      if (h.line > primary.line && h.line < nextHeadingLine) {
        nextHeadingLine = h.line;
      }
    }
    const endIdx = nextHeadingLine - 1;
    if (!isVerificationActionable(lines, primary.line, endIdx, lineFenceState)) {
      issues.push({
        code: "VERIFICATION_NOT_ACTIONABLE",
        section: "Verification",
        line: primary.line,
        message: "Verification has no actionable proof",
        fix: "Add <command or exact surface> \u2192 <observable expected result>, or a fenced command followed by `Expected:` / `\u041E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F:` / `\u041E\u0436\u0438\u0434\u0430\u0435\u043C\u043E:` <observable result>."
      });
    }
  }
  const primaryBySection = new Map;
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length > 0) {
      primaryBySection.set(section, occurrences[0].line);
    }
  }
  const contextLine = primaryBySection.get("Context");
  const approachLine = primaryBySection.get("Approach");
  const anchorsLine = primaryBySection.get("Critical files & anchors");
  const verificationLine = primaryBySection.get("Verification");
  const assumptionsLine = primaryBySection.get("Assumptions & contingencies");
  if (contextLine !== undefined) {
    if (approachLine !== undefined && contextLine > approachLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Approach")`,
        fix: `Move "## Context" before "## Approach".`
      });
    } else if (anchorsLine !== undefined && contextLine > anchorsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Critical files & anchors")`,
        fix: `Move "## Context" before "## Critical files & anchors".`
      });
    } else if (verificationLine !== undefined && contextLine > verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Verification")`,
        fix: `Move "## Context" before "## Verification".`
      });
    } else if (assumptionsLine !== undefined && contextLine > assumptionsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Assumptions & contingencies")`,
        fix: `Move "## Context" before "## Assumptions & contingencies".`
      });
    }
  }
  if (approachLine !== undefined) {
    if (verificationLine !== undefined && approachLine > verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Approach",
        line: approachLine,
        message: `Section "Approach" at line ${approachLine} is out of order (must appear before "Verification")`,
        fix: `Move "## Approach" before "## Verification".`
      });
    } else if (assumptionsLine !== undefined && approachLine > assumptionsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Approach",
        line: approachLine,
        message: `Section "Approach" at line ${approachLine} is out of order (must appear before "Assumptions & contingencies")`,
        fix: `Move "## Approach" before "## Assumptions & contingencies".`
      });
    }
  }
  if (anchorsLine !== undefined) {
    if (approachLine !== undefined && anchorsLine < approachLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Critical files & anchors",
        line: anchorsLine,
        message: `Section "Critical files & anchors" at line ${anchorsLine} is out of order (must appear after "Approach")`,
        fix: `Move "## Critical files & anchors" after "## Approach".`
      });
    } else if (verificationLine !== undefined && anchorsLine > verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Critical files & anchors",
        line: anchorsLine,
        message: `Section "Critical files & anchors" at line ${anchorsLine} is out of order (must appear before "Verification")`,
        fix: `Move "## Critical files & anchors" before "## Verification".`
      });
    }
  }
  if (assumptionsLine !== undefined) {
    if (verificationLine !== undefined && assumptionsLine < verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Assumptions & contingencies",
        line: assumptionsLine,
        message: `Section "Assumptions & contingencies" at line ${assumptionsLine} is out of order (must appear after "Verification")`,
        fix: `Move "## Assumptions & contingencies" after "## Verification".`
      });
    }
  }
  issues.sort((a, b) => {
    const lineA = a.line ?? 0;
    const lineB = b.line ?? 0;
    if (lineA !== lineB) {
      return lineA - lineB;
    }
    const codeCmp = a.code.localeCompare(b.code);
    if (codeCmp !== 0) {
      return codeCmp;
    }
    const secA = a.section ?? "";
    const secB = b.section ?? "";
    return secA.localeCompare(secB);
  });
  return issues;
}
function issueSignature(issues) {
  if (issues.length === 0) {
    return "";
  }
  const pairs = issues.map((issue) => `${issue.code}:${issue.section ?? ""}`);
  pairs.sort((a, b) => a.localeCompare(b));
  return pairs.join(";");
}
function formatRepairPacket(slug, issues, attempt, maxAttempts) {
  const lines = [
    `[PLAN_VALIDATOR_BLOCK] Plan validation failed (Attempt ${attempt} of ${maxAttempts}):`,
    ""
  ];
  issues.forEach((issue, idx) => {
    const loc = [
      issue.section,
      issue.line !== undefined ? `line ${issue.line}` : undefined
    ].filter(Boolean).join(", ");
    const prefix = loc ? `${loc}: ` : "";
    lines.push(`${idx + 1}. [${issue.code}] ${prefix}${issue.message}. Fix: ${issue.fix}`);
  });
  lines.push("");
  lines.push(`Fix every issue above in local://${slug}-plan.md, keep the same slug, reread the complete plan, and do not call xd://propose until all listed issues are fixed.`);
  return lines.join(`
`);
}

// src/extension.ts
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
var MAX_FAILED_VALIDATIONS = 3;
var MAX_SAME_HASH_REPEATS = 2;
var MAX_NO_PROGRESS_ATTEMPTS = 2;
var MAX_TURN_PROPOSALS = 4;
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
  const created = {
    userPrompt: "",
    calls: 0,
    lastCallAt: 0,
    cache: new Map,
    turnState: {
      turnId: 0,
      proposalCount: 0,
      blocked: false,
      cyclesBySlug: new Map
    }
  };
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
    return {
      ok: false,
      code: "PLAN_FILE_MISSING",
      reason: `exact plan artifact is missing: ${parsed.planUrl}; fallback is disabled. If the plan file was written in the same tool-call batch as xd://propose, call xd://propose in a separate subsequent turn because OMP executes all tool_call hooks before writing files`
    };
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
      const validatePlanImpl = dependencies.validatePlan ?? activeTestDependencies.validatePlan ?? validatePlanStructure;
      const sessionId = ctx.sessionManager.getSessionId();
      const state = stateFor(states, sessionId);
      if (event.toolName === "write" && event.input?.path === PROPOSE_PATH) {
        const turn = state.turnState;
        if (turn.blocked) {
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_TURN_BLOCKED] Plan handoff budget exceeded for this user turn. Wait for user feedback or native Refine."
          };
        }
        const check = await preflightProposal(event.input.content, sessionId, ctx.localProtocolOptions);
        if (!check.ok) {
          return { block: true, reason: `[PLAN_HANDOFF_${check.code}] ${check.reason}` };
        }
        turn.proposalCount += 1;
        if (turn.proposalCount > MAX_TURN_PROPOSALS) {
          turn.blocked = true;
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_TURN_BLOCKED] Plan handoff budget exceeded for this user turn. Too many proposals without progress; wait for user feedback or native Refine."
          };
        }
        const planContent = await fs.readFile(check.planPath, "utf8");
        let cycle = turn.cyclesBySlug.get(check.slug);
        if (!cycle) {
          cycle = {
            failedAttempts: 0,
            lastIssues: [],
            sameHashCount: 0,
            noProgressCount: 0,
            blocked: false
          };
          turn.cyclesBySlug.set(check.slug, cycle);
        }
        if (cycle.blocked) {
          return {
            block: true,
            reason: "[PLAN_VALIDATOR_BLOCKED] Automatic repair is stopped for this user turn. Do not call xd://propose again; wait for user feedback or native Refine."
          };
        }
        if (cycle.lastSha256 && check.sha256 === cycle.lastSha256) {
          cycle.failedAttempts += 1;
          cycle.sameHashCount += 1;
          if (cycle.sameHashCount >= MAX_SAME_HASH_REPEATS || cycle.failedAttempts >= MAX_FAILED_VALIDATIONS) {
            cycle.blocked = true;
            if (ctx.hasUI) {
              ctx.ui.notify(`Plan validation stopped for "${check.slug}": repeated unchanged plan without repair`, "error");
            }
            await writeReceipt({
              sessionId,
              kind: "VALIDATOR_STOPPED",
              slug: check.slug,
              sha256: check.sha256,
              attempt: cycle.failedAttempts,
              reason: "SAME_HASH_LIMIT_REACHED",
              issueCount: cycle.lastIssues.length,
              issues: cycle.lastIssues.map((i) => i.code)
            });
            return {
              block: true,
              reason: `[PLAN_VALIDATOR_STOPPED] Automatic plan validation stopped for "${check.slug}". Plan file was repeated without changes (${cycle.sameHashCount} times). Do not call xd://propose again; wait for user feedback or native Refine. Remaining issues:

${formatRepairPacket(check.slug, cycle.lastIssues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`
            };
          }
          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_REJECT",
            slug: check.slug,
            sha256: check.sha256,
            attempt: cycle.failedAttempts,
            reason: "PLAN_FILE_UNCHANGED",
            issueCount: cycle.lastIssues.length,
            issues: cycle.lastIssues.map((i) => i.code)
          });
          return {
            block: true,
            reason: `[PLAN_VALIDATOR_BLOCK] Plan file is unchanged in local://${check.slug}-plan.md (Attempt ${cycle.failedAttempts} of ${MAX_FAILED_VALIDATIONS}). Previous validation issues remain:

${formatRepairPacket(check.slug, cycle.lastIssues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`
          };
        }
        let issues;
        try {
          issues = validatePlanImpl(planContent);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_INTERNAL_ERROR",
            slug: check.slug,
            sha256: check.sha256,
            error: errMsg
          });
          return {
            block: true,
            reason: `[PLAN_VALIDATOR_INTERNAL_ERROR] Plan handoff is blocked because deterministic validation failed internally: ${errMsg}`
          };
        }
        if (issues.length > 0) {
          cycle.failedAttempts += 1;
          const signature = issueSignature(issues);
          const prevCount = cycle.lastIssueCount;
          const prevSignature = cycle.lastIssueSignature;
          if (prevCount !== undefined && issues.length < prevCount && signature !== prevSignature) {
            cycle.sameHashCount = 0;
            cycle.noProgressCount = 0;
          } else if (prevCount !== undefined) {
            cycle.noProgressCount += 1;
          }
          cycle.lastSha256 = check.sha256;
          cycle.lastIssueSignature = signature;
          cycle.lastIssueCount = issues.length;
          cycle.lastIssues = [...issues];
          const limitReached = cycle.failedAttempts >= MAX_FAILED_VALIDATIONS || cycle.noProgressCount >= MAX_NO_PROGRESS_ATTEMPTS;
          if (limitReached) {
            cycle.blocked = true;
            if (ctx.hasUI) {
              ctx.ui.notify(`Plan validation stopped for "${check.slug}": limit reached without convergence`, "error");
            }
            await writeReceipt({
              sessionId,
              kind: "VALIDATOR_STOPPED",
              slug: check.slug,
              sha256: check.sha256,
              attempt: cycle.failedAttempts,
              issueCount: issues.length,
              issues: issues.map((i) => i.code),
              noProgressCount: cycle.noProgressCount
            });
            return {
              block: true,
              reason: `[PLAN_VALIDATOR_STOPPED] Automatic plan validation stopped for "${check.slug}". Maximum repair attempts or no-progress limit reached (${cycle.failedAttempts} attempts, ${cycle.noProgressCount} no-progress iterations). Do not call xd://propose again; wait for user feedback or native Refine. Remaining issues:

${formatRepairPacket(check.slug, issues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)}`
            };
          }
          await writeReceipt({
            sessionId,
            kind: "VALIDATOR_REJECT",
            slug: check.slug,
            sha256: check.sha256,
            attempt: cycle.failedAttempts,
            issueCount: issues.length,
            issues: issues.map((i) => i.code)
          });
          return {
            block: true,
            reason: formatRepairPacket(check.slug, issues, cycle.failedAttempts, MAX_FAILED_VALIDATIONS)
          };
        }
        turn.cyclesBySlug.delete(check.slug);
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
      const state = stateFor(states, ctx.sessionManager.getSessionId());
      state.userPrompt = event.prompt ?? "";
      state.turnState.turnId += 1;
      state.turnState.proposalCount = 0;
      state.turnState.blocked = false;
      state.turnState.cyclesBySlug.clear();
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
  createPlanProtectionForTest,
  planProtection as default,
  formatRepairPacket,
  issueSignature,
  setTestDependencies,
  validatePlanStructure
};
