export type PlanSection =
  | "Context"
  | "Approach"
  | "Critical files & anchors"
  | "Verification"
  | "Assumptions & contingencies";

export type PlanIssue = {
  code:
    | "PLAN_EMPTY"
    | "SECTION_MISSING"
    | "SECTION_DUPLICATE"
    | "SECTION_ORDER"
    | "SECTION_EMPTY"
    | "APPROACH_TARGET_MISSING"
    | "VERIFICATION_NOT_ACTIONABLE"
    | "PLAN_CORE_INVALID";
  section?: PlanSection;
  line?: number;
  message: string;
  fix: string;
};

const CANONICAL_SECTIONS: readonly PlanSection[] = [
  "Context",
  "Approach",
  "Critical files & anchors",
  "Verification",
  "Assumptions & contingencies",
] as const;

const REQUIRED_SECTIONS: readonly PlanSection[] = [
  "Context",
  "Approach",
  "Verification",
] as const;

interface RawHeading {
  section: PlanSection;
  line: number;
}

interface StepInfo {
  line: number;
  lines: string[];
}

function isTargetToken(raw: string): boolean {
  const token = raw.trim();
  if (!token) return false;
  // 1. Path indicators (/ or \)
  // 2. Symbol / section anchor (#)
  // 3. Namespace delimiter (::)
  if (token.includes("/") || token.includes("\\") || token.includes("#") || token.includes("::")) {
    return true;
  }
  // 4. UI / interface path: Name > Child
  if (/[\p{L}\p{N}_$-]+\s*>\s*[\p{L}\p{N}_$-]+/u.test(token)) {
    return true;
  }
  // 5. Function call: name()
  if (/^[\p{L}_$][\p{L}\p{N}_$]*\s*\(.*\)$/u.test(token)) {
    return true;
  }
  // 6. Identifier chain: name.member
  if (/[\p{L}\p{N}_$-]+\.[\p{L}\p{N}_$-]+/u.test(token)) {
    return true;
  }
  return false;
}

function extractInlineCodeTokens(line: string): string[] {
  const tokens: string[] = [];
  const regex = /`([^`\r\n]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function stepHasTarget(stepLines: readonly string[]): boolean {
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

function getApproachSteps(
  lines: readonly string[],
  primaryLine: number,
  endIndex: number,
  lineFenceState: readonly boolean[]
): StepInfo[] {
  const startIdx = primaryLine; // 0-based index of line after "## Approach"
  const endIdx = endIndex; // 0-based index of line before next H2

  // 1. Check for H3 headings: ### ...
  const h3Indices: number[] = [];
  for (let idx = startIdx; idx < endIdx; idx++) {
    if (lineFenceState[idx]) continue;
    if (/^###\s+(.*?)\s*$/.test(lines[idx])) {
      h3Indices.push(idx);
    }
  }

  if (h3Indices.length > 0) {
    return h3Indices.map((idx, i) => {
      const nextIdx = i + 1 < h3Indices.length ? h3Indices[i + 1] : endIdx;
      const stepLines: string[] = [];
      for (let j = idx; j < nextIdx; j++) {
        if (!lineFenceState[j]) {
          stepLines.push(lines[j]);
        }
      }
      return {
        line: idx + 1,
        lines: stepLines,
      };
    });
  }

  // 2. Check for top-level numbered list items: 1. or 1)
  const numIndices: number[] = [];
  for (let idx = startIdx; idx < endIdx; idx++) {
    if (lineFenceState[idx]) continue;
    if (/^(\d+\.|\d+\))\s+(.*)$/.test(lines[idx])) {
      numIndices.push(idx);
    }
  }

  if (numIndices.length > 0) {
    return numIndices.map((idx, i) => {
      const nextIdx = i + 1 < numIndices.length ? numIndices[i + 1] : endIdx;
      const stepLines: string[] = [];
      for (let j = idx; j < nextIdx; j++) {
        if (!lineFenceState[j]) {
          stepLines.push(lines[j]);
        }
      }
      return {
        line: idx + 1,
        lines: stepLines,
      };
    });
  }

  // 3. If neither H3 nor numbered items exist, the entire section is one step
  const stepLines: string[] = [];
  for (let j = startIdx; j < endIdx; j++) {
    if (!lineFenceState[j]) {
      stepLines.push(lines[j]);
    }
  }
  return [
    {
      line: primaryLine,
      lines: stepLines,
    },
  ];
}

function isVerificationActionable(
  lines: readonly string[],
  primaryLine: number,
  endIndex: number,
  lineFenceState: readonly boolean[]
): boolean {
  const startIdx = primaryLine; // 0-based index of line after "## Verification"
  const endIdx = endIndex; // 0-based index of next H2 heading or EOF

  // Form 1: inline code + (→ or => or ->) + expected result (outside code fences)
  for (let idx = startIdx; idx < endIdx; idx++) {
    if (lineFenceState[idx]) continue;
    const line = lines[idx];
    const match = line.match(/`([^`\r\n]+)`\s*(?:→|=>|->)\s*(\S.*)$/u);
    if (match) {
      const action = match[1].trim();
      const expected = match[2].trim();
      if (action.length > 0 && expected.length > 0) {
        return true;
      }
    }
  }

  // Form 2: non-empty fenced code block followed immediately (skipping blank
  // lines) by a non-empty result line. The result statement is positional and
  // language-neutral: any non-empty line that is not a Markdown heading names
  // the observable result, in any language. Legacy marker tokens (Expected: /
  // Ожидается: / Ожидаемо:) still work because they are just result lines.
  for (let idx = startIdx; idx < endIdx; idx++) {
    const line = lines[idx];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[2][0];
      const len = fenceMatch[2].length;
      let closeIdx = -1;
      let hasBlockContent = false;
      for (let j = idx + 1; j < endIdx; j++) {
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
        // The first non-empty line after the closing fence is the result
        // statement. A heading is structure, not a result: it does not qualify.
        for (let k = closeIdx + 1; k < endIdx; k++) {
          const nextLine = lines[k].trim();
          if (nextLine.length === 0) continue;
          if (!/^#{1,6}\s/.test(nextLine)) {
            return true;
          }
          // A heading right after the block is not an observable result.
          break;
        }
        idx = closeIdx;
      }
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Machine-readable plan core (optional JSON front-matter)
// ---------------------------------------------------------------------------
// A plan MAY start with a JSON front-matter block:
//
//   ---
//   {
//     "sections": {
//       "context": "<any-language string>",
//       "approach": [{ "action": "<any-language>", "target": "<exact target>" }],
//       "verification": [{ "command": "<command>", "expects": "<observable result, any language>" }]
//     }
//   }
//   ---
//
// When a valid core is present, the validator checks the DATA and skips the
// Markdown path entirely: heading keys and body language become irrelevant.
// Keys ("sections", "context", "approach", "action", "target", "command",
// "expects") are format literals, like YAML keys: they are not translated.
// Values are free language. Unknown extra keys are ignored (forward compat).

export interface PlanCoreApproachStep {
  action: string;
  target: string;
}

export interface PlanCoreVerificationStep {
  command: string;
  expects: string;
}

export interface PlanCore {
  context: string;
  approach: PlanCoreApproachStep[];
  verification: PlanCoreVerificationStep[];
}

export interface ParsedPlanCore {
  core?: PlanCore;
  /** End line (0-based, exclusive) of the front-matter block, when a block was found. */
  blockEndLine?: number;
  issues: PlanIssue[];
}

const PLAN_CORE_MAX_HEAD_LINES = 100;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function coreIssue(message: string, fix: string, line?: number): PlanIssue {
  return {
    code: "PLAN_CORE_INVALID",
    line,
    message: `Plan core (front-matter): ${message}`,
    fix,
  };
}

export function parsePlanCore(lines: readonly string[]): ParsedPlanCore {
  if ((lines[0] ?? "").trim() !== "---") {
    return { issues: [] };
  }
  let closeLine = -1;
  const limit = Math.min(lines.length, PLAN_CORE_MAX_HEAD_LINES);
  for (let i = 1; i < limit; i++) {
    if ((lines[i] ?? "").trim() === "---") {
      closeLine = i;
      break;
    }
  }
  if (closeLine === -1) {
    // No closing fence: treat the file as a plain Markdown plan (no core).
    return { issues: [] };
  }

  const jsonText = lines.slice(1, closeLine).join("\n");
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      blockEndLine: closeLine + 1,
      issues: [
        coreIssue(
          `front-matter is not valid JSON (${String((error as Error).message).split("\n")[0]})`,
          "Fix the JSON syntax inside the leading --- ... --- block, or remove the block to validate as a Markdown plan.",
          1,
        ),
      ],
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      blockEndLine: closeLine + 1,
      issues: [coreIssue("front-matter root must be a JSON object", 'Use {"sections": {...}} as the root object.', 1)],
    };
  }

  const root = parsed as Record<string, unknown>;
  const sectionsValue = root.sections;
  if (typeof sectionsValue !== "object" || sectionsValue === null || Array.isArray(sectionsValue)) {
    return {
      blockEndLine: closeLine + 1,
      issues: [
        coreIssue(
          '"sections" must be an object with keys "context", "approach", "verification"',
          'Add "sections": { "context": "<string>", "approach": [...], "verification": [...] }.',
          1,
        ),
      ],
    };
  }

  const sections = sectionsValue as Record<string, unknown>;
  const issues: PlanIssue[] = [];

  if (!isNonEmptyString(sections.context)) {
    issues.push(
      coreIssue(
        '"sections.context" must be a non-empty string',
        'Set "sections.context" to a short description of the task (any language).',
        1,
      ),
    );
  }

  const approach = sections.approach;
  if (!Array.isArray(approach) || approach.length === 0) {
    issues.push(
      coreIssue(
        '"sections.approach" must be a non-empty array of { "action", "target" } objects',
        'List at least one step: { "action": "<what to do>", "target": "<exact file/symbol/route>" }.',
        1,
      ),
    );
  } else {
    approach.forEach((step, index) => {
      const entry = `sections.approach[${index}]`;
      if (typeof step !== "object" || step === null || Array.isArray(step)) {
        issues.push(coreIssue(`${entry} must be an object`, `Use { "action": "...", "target": "..." } for ${entry}.`, 1));
        return;
      }
      const record = step as Record<string, unknown>;
      if (!isNonEmptyString(record.action)) {
        issues.push(coreIssue(`${entry}.action must be a non-empty string`, `Set ${entry}.action (any language).`, 1));
      }
      if (!isNonEmptyString(record.target)) {
        issues.push(coreIssue(`${entry}.target must be a non-empty exact target`, `Set ${entry}.target to an exact file, symbol, route, or UI path.`, 1));
      }
    });
  }

  const verification = sections.verification;
  if (!Array.isArray(verification) || verification.length === 0) {
    issues.push(
      coreIssue(
        '"sections.verification" must be a non-empty array of { "command", "expects" } objects',
        'List at least one proof: { "command": "<command>", "expects": "<observable result, any language>" }.',
        1,
      ),
    );
  } else {
    verification.forEach((step, index) => {
      const entry = `sections.verification[${index}]`;
      if (typeof step !== "object" || step === null || Array.isArray(step)) {
        issues.push(coreIssue(`${entry} must be an object`, `Use { "command": "...", "expects": "..." } for ${entry}.`, 1));
        return;
      }
      const record = step as Record<string, unknown>;
      if (!isNonEmptyString(record.command)) {
        issues.push(coreIssue(`${entry}.command must be a non-empty string`, `Set ${entry}.command to the exact verification command.`, 1));
      }
      if (!isNonEmptyString(record.expects)) {
        issues.push(coreIssue(`${entry}.expects must be a non-empty observable result`, `Set ${entry}.expects (any language).`, 1));
      }
    });
  }

  if (issues.length > 0) {
    return { blockEndLine: closeLine + 1, issues };
  }

  return {
    blockEndLine: closeLine + 1,
    issues: [],
    core: {
      context: (sections.context as string).trim(),
      approach: (approach as PlanCoreApproachStep[]).map((step) => ({
        action: (step as PlanCoreApproachStep).action.trim(),
        target: (step as PlanCoreApproachStep).target.trim(),
      })),
      verification: (verification as PlanCoreVerificationStep[]).map((step) => ({
        command: (step as PlanCoreVerificationStep).command.trim(),
        expects: (step as PlanCoreVerificationStep).expects.trim(),
      })),
    },
  };
}

export function validatePlanStructure(markdown: string): PlanIssue[] {
  if (!markdown || markdown.trim().length === 0) {
    return [
      {
        code: "PLAN_EMPTY",
        line: 1,
        message: "Plan file is empty",
        fix: "Write a complete plan with Context, Approach, and Verification sections.",
      },
    ];
  }

  // Machine-readable plan core (optional JSON front-matter) takes precedence:
  // when a core block is present, the DATA is validated and the Markdown path
  // (heading keys, section order, prose proofs) is skipped entirely.
  const parsedCore = parsePlanCore(markdown.split(/\r?\n/));
  if (parsedCore.blockEndLine !== undefined) {
    return parsedCore.issues;
  }


  const lines = markdown.split(/\r?\n/);
  const issues: PlanIssue[] = [];

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  const lineFenceState: boolean[] = new Array(lines.length).fill(false);

  const headings: RawHeading[] = [];

  for (let i = 0; i < lines.length; i++) {
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

  // Group by section to find missing and duplicates
  const occurrencesBySection = new Map<PlanSection, RawHeading[]>();
  for (const s of CANONICAL_SECTIONS) {
    occurrencesBySection.set(s, []);
  }
  for (const h of headings) {
    occurrencesBySection.get(h.section)!.push(h);
  }

  // 1. Missing required sections
  for (const req of REQUIRED_SECTIONS) {
    const occurrences = occurrencesBySection.get(req)!;
    if (occurrences.length === 0) {
      issues.push({
        code: "SECTION_MISSING",
        section: req,
        message: `Required section "${req}" is missing`,
        fix: `Add a section whose heading line is exactly "## ${req}" (English literal; translations, bilingual, or decorated headings are not matched).`,
      });
    }
  }

  // 2. Duplicate sections (report for every extra line)
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length > 1) {
      for (let i = 1; i < occurrences.length; i++) {
        const extra = occurrences[i];
        issues.push({
          code: "SECTION_DUPLICATE",
          section,
          line: extra.line,
          message: `Duplicate section "${section}" at line ${extra.line}`,
          fix: `Remove duplicate "## ${section}" heading and consolidate content under the primary section at line ${occurrences[0].line}.`,
        });
      }
    }
  }

  // 3. Section empty check (for present sections, check primary occurrence)
  const emptySections = new Set<PlanSection>();
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length === 0) {
      continue; // Missing sections already reported, do not add dependent SECTION_EMPTY
    }
    const primary = occurrences[0];
    const startIndex = primary.line; // line after heading (1-based line -> 0-based index)
    let nextHeadingLine = lines.length + 1;
    for (const h of headings) {
      if (h.line > primary.line && h.line < nextHeadingLine) {
        nextHeadingLine = h.line;
      }
    }
    const endIndex = nextHeadingLine - 1; // 1-based line of last line of this section

    let hasContent = false;
    for (let idx = startIndex; idx < endIndex; idx++) {
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
        fix: `Add content to "## ${section}".`,
      });
    }
  }

  // 4. Approach target validation: only if Approach is present, unique, and non-empty
  const approachOccurrences = occurrencesBySection.get("Approach")!;
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
          fix: "Add an exact target using inline code, e.g. `src/file.ts#symbol`, `GET /api/orders`, `Settings > Billing`.",
        });
      }
    }
  }

  // 5. Verification actionable validation: only if Verification is present, unique, and non-empty
  const verificationOccurrences = occurrencesBySection.get("Verification")!;
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
        fix: 'Add <command or exact surface> → <observable expected result>, or a fenced command block followed immediately by a line stating the observable result (any language; `Expected:` / `Ожидается:` / `Ожидаемо:` markers are accepted but not required).',
      });
    }
  }

  // 6. Section order check (for primary occurrences of present sections)
  const primaryBySection = new Map<PlanSection, number>();
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
        fix: `Move "## Context" before "## Approach".`,
      });
    } else if (anchorsLine !== undefined && contextLine > anchorsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Critical files & anchors")`,
        fix: `Move "## Context" before "## Critical files & anchors".`,
      });
    } else if (verificationLine !== undefined && contextLine > verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Verification")`,
        fix: `Move "## Context" before "## Verification".`,
      });
    } else if (assumptionsLine !== undefined && contextLine > assumptionsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Context",
        line: contextLine,
        message: `Section "Context" at line ${contextLine} is out of order (must appear before "Assumptions & contingencies")`,
        fix: `Move "## Context" before "## Assumptions & contingencies".`,
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
        fix: `Move "## Approach" before "## Verification".`,
      });
    } else if (assumptionsLine !== undefined && approachLine > assumptionsLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Approach",
        line: approachLine,
        message: `Section "Approach" at line ${approachLine} is out of order (must appear before "Assumptions & contingencies")`,
        fix: `Move "## Approach" before "## Assumptions & contingencies".`,
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
        fix: `Move "## Critical files & anchors" after "## Approach".`,
      });
    } else if (verificationLine !== undefined && anchorsLine > verificationLine) {
      issues.push({
        code: "SECTION_ORDER",
        section: "Critical files & anchors",
        line: anchorsLine,
        message: `Section "Critical files & anchors" at line ${anchorsLine} is out of order (must appear before "Verification")`,
        fix: `Move "## Critical files & anchors" before "## Verification".`,
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
        fix: `Move "## Assumptions & contingencies" after "## Verification".`,
      });
    }
  }

  // Sort: by position in file (undefined first), then by code, then by section
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

export function issueSignature(issues: readonly PlanIssue[]): string {
  if (issues.length === 0) {
    return "";
  }
  const pairs = issues.map((issue) => `${issue.code}:${issue.section ?? ""}`);
  pairs.sort((a, b) => a.localeCompare(b));
  return pairs.join(";");
}

export function formatRepairPacket(
  slug: string,
  issues: readonly PlanIssue[],
  attempt: number,
  maxAttempts: number
): string {
  const lines: string[] = [
    `[PLAN_VALIDATOR_BLOCK] Plan validation failed (Attempt ${attempt} of ${maxAttempts}):`,
    "",
  ];
  issues.forEach((issue, idx) => {
    const loc = [
      issue.section,
      issue.line !== undefined ? `line ${issue.line}` : undefined,
    ].filter(Boolean).join(", ");
    const prefix = loc ? `${loc}: ` : "";
    lines.push(`${idx + 1}. [${issue.code}] ${prefix}${issue.message}. Fix: ${issue.fix}`);
  });
  lines.push("");
  lines.push(
    `Fix every issue above in local://${slug}-plan.md, keep the same slug, reread the complete plan, and do not call xd://propose until all listed issues are fixed.`
  );
  return lines.join("\n");
}
