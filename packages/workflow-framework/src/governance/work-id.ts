/**
 * Work ID governance utilities.
 *
 * Work IDs are the single most important traceability primitive in the Golden
 * Path. Every commit, branch, PR title, and audit event must carry a Work ID
 * so that deployments can be traced back to planned work.
 *
 * Conventions enforced here:
 *   - Default pattern: ^[A-Z]+-[0-9]+$  (e.g. FIN-123, PLAT-456)
 *   - Branch pattern:  ^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$
 *   - Commit pattern:  ^\[[A-Z]+-[0-9]+\] .+
 *   - PR title:        ^\[[A-Z]+-[0-9]+\] .+
 *
 * All patterns are configurable via devex.yaml (workTracking section) so that
 * teams using Linear, Shortcut, or custom trackers can adapt.
 */

export interface WorkIdConfig {
  /** Regex string that a bare Work ID must satisfy. */
  workIdPattern: string;
  /** Regex string that a branch name must satisfy. */
  branchPattern: string;
  /** Regex string that a commit message must satisfy. */
  commitPattern: string;
  /** Regex string that a PR title must satisfy. */
  prTitlePattern: string;
}

/** Defaults that mirror the devex.yaml schema defaults. */
export const DEFAULT_WORK_ID_CONFIG: WorkIdConfig = {
  workIdPattern: "^[A-Z]+-[0-9]+$",
  branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
  commitPattern: "^\\[[A-Z]+-[0-9]+\\] .+",
  prTitlePattern: "^\\[[A-Z]+-[0-9]+\\] .+",
};

// ---------------------------------------------------------------------------
// Core validators
// ---------------------------------------------------------------------------

export interface WorkIdValidationResult {
  valid: boolean;
  workId: string | null;
  message: string;
}

/**
 * Validates a bare Work ID string against the configured pattern.
 *
 * @example
 * validateWorkId("FIN-123")  → { valid: true, workId: "FIN-123" }
 * validateWorkId("fin123")   → { valid: false, workId: null, message: "..." }
 */
export function validateWorkId(
  value: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): WorkIdValidationResult {
  const pattern = new RegExp(config.workIdPattern);

  if (pattern.test(value.trim())) {
    return { valid: true, workId: value.trim(), message: "Work ID is valid." };
  }

  return {
    valid: false,
    workId: null,
    message:
      `"${value}" does not match the required Work ID pattern: ${config.workIdPattern}. ` +
      `Expected format: PROJECT-NUMBER (e.g. FIN-123).`,
  };
}

/**
 * Validates a branch name against the configured branch pattern.
 * Also extracts the Work ID embedded in the branch name when valid.
 *
 * @example
 * validateBranchName("feature/FIN-123-add-validation")
 *   → { valid: true, workId: "FIN-123" }
 *
 * validateBranchName("feature/add-validation")
 *   → { valid: false, workId: null, message: "..." }
 */
export function validateBranchName(
  branchName: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): WorkIdValidationResult {
  const pattern = new RegExp(config.branchPattern);

  if (!pattern.test(branchName)) {
    return {
      valid: false,
      workId: null,
      message:
        `Branch name "${branchName}" does not match the required Work ID branch pattern:\n` +
        `  ${config.branchPattern}\n` +
        `Expected format: <type>/<WORK-ID>-<description> ` +
        `(e.g. feature/FIN-123-add-transaction-validation).`,
    };
  }

  const workId = extractWorkIdFromBranch(branchName, config);
  return {
    valid: true,
    workId,
    message: workId
      ? `Branch contains Work ID ${workId}.`
      : "Branch is valid but no Work ID could be extracted.",
  };
}

/**
 * Validates a commit message against the configured commit pattern.
 *
 * @example
 * validateCommitMessage("[FIN-123] Add transaction validation")
 *   → { valid: true, workId: "FIN-123" }
 */
export function validateCommitMessage(
  message: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): WorkIdValidationResult {
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  const pattern = new RegExp(config.commitPattern);

  if (!pattern.test(firstLine)) {
    return {
      valid: false,
      workId: null,
      message:
        `Commit message "${firstLine}" does not match the required Work ID commit pattern:\n` +
        `  ${config.commitPattern}\n` +
        `Expected format: [WORK-ID] Description (e.g. [FIN-123] Add transaction validation).`,
    };
  }

  const workId = extractWorkIdFromText(firstLine, config);
  return {
    valid: true,
    workId,
    message: workId
      ? `Commit message contains Work ID ${workId}.`
      : "Commit message is valid.",
  };
}

/**
 * Validates a PR title against the configured PR title pattern.
 *
 * @example
 * validatePrTitle("[FIN-123] Add transaction validation")
 *   → { valid: true, workId: "FIN-123" }
 */
export function validatePrTitle(
  title: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): WorkIdValidationResult {
  const pattern = new RegExp(config.prTitlePattern);

  if (!pattern.test(title.trim())) {
    return {
      valid: false,
      workId: null,
      message:
        `PR title "${title}" does not match the required pattern:\n` +
        `  ${config.prTitlePattern}\n` +
        `Expected format: [WORK-ID] Description (e.g. [FIN-123] Add transaction validation).`,
    };
  }

  const workId = extractWorkIdFromText(title, config);
  return {
    valid: true,
    workId,
    message: workId
      ? `PR title contains Work ID ${workId}.`
      : "PR title is valid.",
  };
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

export interface CommitValidationSummary {
  /** Total commits evaluated. */
  total: number;
  /** Commits that passed the pattern check. */
  passed: number;
  /** Commit messages (first lines) that failed the pattern check. */
  violations: string[];
}

/**
 * Validates a list of commit messages and returns a summary.
 * Use this in the governance job to check all commits in a PR.
 */
export function validateCommitMessages(
  messages: string[],
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): CommitValidationSummary {
  const violations: string[] = [];
  let passed = 0;

  for (const message of messages) {
    const result = validateCommitMessage(message, config);
    if (result.valid) {
      passed++;
    } else {
      violations.push(message.split("\n")[0]?.trim() ?? message);
    }
  }

  return { total: messages.length, passed, violations };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a Work ID from a branch name using the workIdPattern.
 * Returns null if no Work ID is found.
 *
 * @example
 * extractWorkIdFromBranch("feature/FIN-123-add-validation") → "FIN-123"
 */
export function extractWorkIdFromBranch(
  branchName: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): string | null {
  return extractWorkIdFromText(branchName, config);
}

/**
 * Extracts a Work ID from arbitrary text using the workIdPattern.
 * Uses the first match found. Returns null if no match.
 */
export function extractWorkIdFromText(
  text: string,
  config: WorkIdConfig = DEFAULT_WORK_ID_CONFIG
): string | null {
  // Strip regex anchors for use as a search pattern within larger strings
  const innerPattern = config.workIdPattern
    .replace(/^\^/, "")
    .replace(/\$$/, "");

  const searchRegex = new RegExp(innerPattern, "g");
  const match = searchRegex.exec(text);
  return match?.[0] ?? null;
}

// ---------------------------------------------------------------------------
// Branch name builder (used by CLI `devex branch`)
// ---------------------------------------------------------------------------

export type BranchType = "feature" | "fix" | "chore" | "hotfix";

/**
 * Builds a compliant branch name from a type, Work ID, and description.
 *
 * @example
 * buildBranchName("feature", "FIN-123", "add transaction validation")
 *   → "feature/FIN-123-add-transaction-validation"
 */
export function buildBranchName(
  type: BranchType,
  workId: string,
  description: string
): string {
  const slug = description
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${type}/${workId}-${slug}`;
}

/**
 * Builds a compliant commit message first line.
 *
 * @example
 * buildCommitMessage("FIN-123", "add transaction validation")
 *   → "[FIN-123] add transaction validation"
 */
export function buildCommitMessage(workId: string, description: string): string {
  return `[${workId}] ${description.trim()}`;
}

/**
 * Builds a compliant PR title.
 *
 * @example
 * buildPrTitle("FIN-123", "Add transaction validation")
 *   → "[FIN-123] Add transaction validation"
 */
export function buildPrTitle(workId: string, title: string): string {
  return `[${workId}] ${title.trim()}`;
}
