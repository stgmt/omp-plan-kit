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
    | "SECTION_EMPTY";
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

interface SectionOccurrence {
  section: PlanSection;
  line: number;
  contentStartLine: number;
  contentEndLine: number;
  hasContent: boolean;
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

  const lines = markdown.split(/\r?\n/);
  const issues: PlanIssue[] = [];

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;

  interface RawHeading {
    section: PlanSection;
    line: number;
  }

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
        continue;
      } else if (char === fenceChar && len >= fenceLen) {
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
        continue;
      }
    }

    if (inFence) {
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
        fix: `Add "## ${req}" section to the plan.`,
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
  for (const [section, occurrences] of occurrencesBySection.entries()) {
    if (occurrences.length === 0) {
      continue; // Missing sections already reported, do not add dependent SECTION_EMPTY
    }
    const primary = occurrences[0];
    const startIndex = primary.line; // line after heading (1-based line -> 0-based index)
    // Find next heading line after this heading, regardless of section
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
      issues.push({
        code: "SECTION_EMPTY",
        section,
        line: primary.line,
        message: `Section "${section}" at line ${primary.line} is empty`,
        fix: `Add content to "## ${section}".`,
      });
    }
  }

  // 4. Section order check (for primary occurrences of present sections)
  // Canonical rules:
  // - Context must appear before Approach, Critical files & anchors, Verification, Assumptions & contingencies
  // - Approach must appear after Context (if present) and before Critical files & anchors, Verification, Assumptions & contingencies
  // - Critical files & anchors must appear after Approach and before Verification, Assumptions & contingencies
  // - Verification must appear after Approach, Critical files & anchors (if present) and before Assumptions & contingencies
  // - Assumptions & contingencies must appear after Verification
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
