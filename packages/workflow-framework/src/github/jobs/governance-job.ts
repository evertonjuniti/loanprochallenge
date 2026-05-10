import type { DevexConfig } from "../../config/devex-config.schema.js";
import { checkoutStep, nodeBootstrapSteps } from "../steps.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// Governance job
//
// The first job in every PR pipeline. Fails fast if any convention is
// violated so developers get actionable feedback before tests even run.
//
// Checks performed (in order):
//   1. Branch name contains a valid Work ID and matches the branch pattern.
//   2. PR title contains the Work ID (skipped on push events).
//   3. Every commit in the PR range contains the Work ID.
//   4. Workflow framework ref is a pinned semver tag or full SHA
//      (only when `workflowVersion` is set in devex.yaml).
//
// Each check writes an inline ESM script to a temp file, then runs it with
// Node.js. The scripts import from `@loanpro/devex-workflow-framework`,
// which the service repo has installed as a devDependency.
// ---------------------------------------------------------------------------

export interface GovernanceJobOptions {
  /** Runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
}

/**
 * Builds the governance job definition for a PR workflow.
 *
 * The job has no `needs` dependency — it runs immediately when the workflow
 * is triggered and gates all downstream jobs.
 */
export function buildGovernanceJob(
  config: DevexConfig,
  options: GovernanceJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const wt = config.workTracking;

  // Pattern env vars let the inline scripts read them at runtime, so the
  // generated workflow works even if devex.yaml is updated later.
  const workIdPattern = wt?.workIdPattern ?? "^[A-Z]+-[0-9]+$";
  const branchPattern =
    wt?.branchPattern ?? "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$";
  const commitPattern = wt?.commitPattern ?? "^\\\\[[A-Z]+-[0-9]+\\\\] .+";
  const prTitlePattern = wt?.prTitlePattern ?? "^\\\\[[A-Z]+-[0-9]+\\\\] .+";

  const steps: GithubStep[] = [
    checkoutStep(true /* full history for git log range */),
    ...nodeBootstrapSteps(),

    // ------------------------------------------------------------------
    // Step 1 — Branch name
    // ------------------------------------------------------------------
    {
      id: "validate-branch",
      name: "Validate branch name",
      env: {
        BRANCH_NAME: "${{ github.head_ref || github.ref_name }}",
        WORK_ID_PATTERN: workIdPattern,
        BRANCH_PATTERN: branchPattern,
      },
      run: inlineScript("DEVEX_BRANCH_CHECK", [
        `import { validateBranchName, DEFAULT_WORK_ID_CONFIG } from "@loanpro/devex-workflow-framework";`,
        `const cfg = {`,
        `  ...DEFAULT_WORK_ID_CONFIG,`,
        `  workIdPattern: process.env.WORK_ID_PATTERN ?? DEFAULT_WORK_ID_CONFIG.workIdPattern,`,
        `  branchPattern: process.env.BRANCH_PATTERN ?? DEFAULT_WORK_ID_CONFIG.branchPattern,`,
        `};`,
        `const result = validateBranchName(process.env.BRANCH_NAME ?? "", cfg);`,
        `if (!result.valid) {`,
        `  process.stderr.write("::error::" + result.message + "\\n");`,
        `  process.exit(1);`,
        `}`,
        `console.log("✓ Branch Work ID:", result.workId);`,
      ]),
    },

    // ------------------------------------------------------------------
    // Step 2 — PR title (skipped on push events where title is absent)
    // ------------------------------------------------------------------
    {
      id: "validate-pr-title",
      name: "Validate PR title",
      env: {
        PR_TITLE: "${{ github.event.pull_request.title || '' }}",
        PR_TITLE_PATTERN: prTitlePattern,
      },
      run: inlineScript("DEVEX_PR_TITLE_CHECK", [
        `import { validatePrTitle, DEFAULT_WORK_ID_CONFIG } from "@loanpro/devex-workflow-framework";`,
        `const title = process.env.PR_TITLE ?? "";`,
        `if (!title) { console.log("⚠ No PR title (push event) — skipping."); process.exit(0); }`,
        `const cfg = {`,
        `  ...DEFAULT_WORK_ID_CONFIG,`,
        `  prTitlePattern: process.env.PR_TITLE_PATTERN ?? DEFAULT_WORK_ID_CONFIG.prTitlePattern,`,
        `};`,
        `const result = validatePrTitle(title, cfg);`,
        `if (!result.valid) {`,
        `  process.stderr.write("::error::" + result.message + "\\n");`,
        `  process.exit(1);`,
        `}`,
        `console.log("✓ PR title Work ID:", result.workId);`,
      ]),
    },

    // ------------------------------------------------------------------
    // Step 3 — Commit messages in PR range
    // ------------------------------------------------------------------
    {
      id: "validate-commits",
      name: "Validate commit messages",
      env: {
        BASE_SHA: "${{ github.event.pull_request.base.sha || github.event.before || '' }}",
        HEAD_SHA: "${{ github.sha }}",
        COMMIT_PATTERN: commitPattern,
      },
      run: inlineScript("DEVEX_COMMIT_CHECK", [
        `import { execSync } from "node:child_process";`,
        `import { validateCommitMessages, DEFAULT_WORK_ID_CONFIG } from "@loanpro/devex-workflow-framework";`,
        `const base = process.env.BASE_SHA ?? "";`,
        `const head = process.env.HEAD_SHA ?? "";`,
        `const range = base && head ? base + ".." + head : "HEAD~1..HEAD";`,
        `let raw = "";`,
        `try { raw = execSync("git log --pretty=%s " + range, { encoding: "utf-8" }); }`,
        `catch { console.log("⚠ Could not read git range " + range + " — skipping."); process.exit(0); }`,
        `const messages = raw.split("\\n").map(m => m.trim()).filter(Boolean);`,
        `if (messages.length === 0) { console.log("⚠ No commits in range — skipping."); process.exit(0); }`,
        `const cfg = {`,
        `  ...DEFAULT_WORK_ID_CONFIG,`,
        `  commitPattern: process.env.COMMIT_PATTERN ?? DEFAULT_WORK_ID_CONFIG.commitPattern,`,
        `};`,
        `const summary = validateCommitMessages(messages, cfg);`,
        `if (summary.violations.length > 0) {`,
        `  process.stderr.write("::error::Commits missing Work ID:\\n");`,
        `  summary.violations.forEach(v => process.stderr.write("  • " + v + "\\n"));`,
        `  process.exit(1);`,
        `}`,
        `console.log("✓ All " + messages.length + " commit(s) contain a Work ID.");`,
      ]),
    },
  ];

  // ------------------------------------------------------------------
  // Step 4 — Workflow ref (only when pinned in devex.yaml)
  // ------------------------------------------------------------------
  if (config.workflowVersion) {
    steps.push({
      id: "validate-workflow-ref",
      name: "Validate workflow framework ref",
      env: {
        WORKFLOW_REF: config.workflowVersion.ref,
      },
      run: inlineScript("DEVEX_REF_CHECK", [
        `import { validateWorkflowRef } from "@loanpro/devex-workflow-framework";`,
        `const result = validateWorkflowRef(process.env.WORKFLOW_REF ?? "");`,
        `if (!result.valid) {`,
        `  result.errors.forEach(e => process.stderr.write("::error::" + e.message + "\\n"));`,
        `  process.exit(1);`,
        `}`,
        `console.log("✓ Workflow ref pinned to:", process.env.WORKFLOW_REF);`,
      ]),
    });
  }

  return {
    name: "Governance",
    "runs-on": runsOn,
    steps,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Wraps a list of JavaScript source lines in a `cat`-then-`node` pattern.
 *
 * The generated `run:` string writes the script to a temp file using a
 * heredoc and then executes it with Node.js in ESM mode.
 *
 * YAML literal block scalars strip the consistent indentation prefix, so
 * the heredoc delimiter lands at column 0 in the shell script — valid bash.
 *
 * @param marker - Unique heredoc delimiter (all-caps, no spaces).
 * @param lines  - Lines of the ESM script body.
 */
function inlineScript(marker: string, lines: string[]): string {
  const dest = `/tmp/_${marker.toLowerCase()}.mjs`;
  return [
    `cat << '${marker}' > ${dest}`,
    ...lines,
    marker,
    `node ${dest}`,
  ].join("\n");
}
