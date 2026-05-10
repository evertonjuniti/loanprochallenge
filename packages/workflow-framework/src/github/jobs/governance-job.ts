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
    // Step 1 — Branch name (skipped on push events, e.g. merge to main)
    // ------------------------------------------------------------------
    {
      id: "validate-branch",
      name: "Validate branch name",
      env: {
        BRANCH_NAME: "${{ github.head_ref || '' }}",
        WORK_ID_PATTERN: workIdPattern,
        BRANCH_PATTERN: branchPattern,
      },
      run: inlineScript("DEVEX_BRANCH_CHECK", [
        `const branch = process.env.BRANCH_NAME ?? "";`,
        `if (!branch) { console.log("⚠ No head_ref (push event) — skipping branch name check."); process.exit(0); }`,
        `const branchPattern = process.env.BRANCH_PATTERN ?? "";`,
        `const workIdPattern = process.env.WORK_ID_PATTERN ?? "";`,
        `if (!new RegExp(branchPattern).test(branch)) {`,
        `  process.stderr.write(\`::error::Branch name "\${branch}" does not match required pattern: \${branchPattern}. Expected: <type>/<WORK-ID>-<description> (e.g. feature/FIN-123-fix-login).\\n\`);`,
        `  process.exit(1);`,
        `}`,
        `const workIdMatch = branch.match(new RegExp(workIdPattern));`,
        `console.log("✓ Branch Work ID:", workIdMatch ? workIdMatch[0] : "(extracted from branch)");`,
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
        `const title = process.env.PR_TITLE ?? "";`,
        `if (!title) { console.log("⚠ No PR title (push event) — skipping."); process.exit(0); }`,
        `const prTitlePattern = process.env.PR_TITLE_PATTERN ?? "";`,
        `if (!new RegExp(prTitlePattern).test(title.trim())) {`,
        `  process.stderr.write(\`::error::PR title "\${title}" does not match required pattern: \${prTitlePattern}. Expected: [WORK-ID] Description (e.g. [FIN-123] Add transaction validation).\\n\`);`,
        `  process.exit(1);`,
        `}`,
        `const workIdMatch = title.match(/[A-Z]+-[0-9]+/);`,
        `console.log("✓ PR title Work ID:", workIdMatch ? workIdMatch[0] : null);`,
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
        `const base = process.env.BASE_SHA ?? "";`,
        `const head = process.env.HEAD_SHA ?? "";`,
        `const range = base && head ? base + ".." + head : "HEAD~1..HEAD";`,
        `let raw = "";`,
        `try { raw = execSync("git log --pretty=%s " + range, { encoding: "utf-8" }); }`,
        `catch { console.log("⚠ Could not read git range " + range + " — skipping."); process.exit(0); }`,
        `const messages = raw.split("\\n").map(m => m.trim()).filter(Boolean).filter(m => !m.startsWith("Merge "));`,
        `if (messages.length === 0) { console.log("⚠ No commits in range (only merge commits) — skipping."); process.exit(0); }`,
        `const commitPattern = process.env.COMMIT_PATTERN ?? "";`,
        `const violations = messages.filter(m => !new RegExp(commitPattern).test(m));`,
        `if (violations.length > 0) {`,
        `  process.stderr.write("::error::Commits missing Work ID:\\n");`,
        `  violations.forEach(v => process.stderr.write("  • " + v + "\\n"));`,
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
        `const ref = process.env.WORKFLOW_REF ?? "";`,
        `const approved = /^(v\\d+\\.\\d+\\.\\d+|[0-9a-f]{40})$/.test(ref);`,
        `if (!approved) {`,
        `  process.stderr.write(\`::error::Ref "\${ref}" is not a pinned semver tag (e.g. v0.1.0) or full 40-char SHA. Using floating refs like "main" or "latest" is prohibited.\\n\`);`,
        `  process.exit(1);`,
        `}`,
        `console.log("✓ Workflow ref pinned to:", ref);`,
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
 * Wraps a list of JavaScript source lines in a heredoc piped to
 * `node --input-type=module` via stdin.
 *
 * This avoids writing a temp file, so Node.js module resolution never needs
 * to walk the filesystem looking for node_modules — there is no file location
 * to resolve from. `node:` built-in imports (e.g. node:child_process) still
 * work because they bypass the filesystem entirely.
 *
 * @param marker - Unique heredoc delimiter (all-caps, no spaces).
 * @param lines  - Lines of the ESM script body.
 */
function inlineScript(marker: string, lines: string[]): string {
  return [
    `node --input-type=module << '${marker}'`,
    ...lines,
    marker,
  ].join("\n");
}
