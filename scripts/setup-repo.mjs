#!/usr/bin/env node
/**
 * scripts/setup-repo.mjs
 *
 * Configures GitHub branch protection on the `main` branch so that PRs
 * cannot be merged until all required workflow checks have passed.
 *
 * Required checks are derived automatically from the PR workflow jobs
 * defined in devex.yaml via @loanpro/devex-workflow-framework — no manual
 * list to maintain.
 *
 * Prerequisites:
 *   - GitHub CLI (gh) installed and authenticated: `gh auth login`
 *   - Caller must have admin or owner permissions on the repository.
 *
 * Usage (from repo root):
 *   node scripts/setup-repo.mjs
 *
 * What it configures on `main`:
 *   - Require all PR pipeline checks to pass before merging.
 *   - Require the branch to be up to date with main before merging.
 *   - Does NOT configure required reviewers or push restrictions
 *     (add those manually in GitHub Settings if needed).
 */

import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const frameworkDist = join(repoRoot, "packages/workflow-framework/dist/index.js");
const devexYamlPath = join(repoRoot, "packages/workflow-framework/devex.yaml");

// ---------------------------------------------------------------------------
// 1. Verify gh CLI is available and authenticated
// ---------------------------------------------------------------------------
try {
  execSync("gh auth status", { stdio: "pipe" });
} catch {
  console.error(
    "✗ GitHub CLI (gh) is not authenticated. Run `gh auth login` first."
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Detect owner/repo from git remote
// ---------------------------------------------------------------------------
const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
const ghMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
if (!ghMatch) {
  console.error(`✗ Could not parse a GitHub repository URL from remote: ${remoteUrl}`);
  process.exit(1);
}
const repo = ghMatch[1]; // e.g. "evertonjuniti/loanprochallenge"

// ---------------------------------------------------------------------------
// 3. Load framework and derive required check contexts from PR workflow
// ---------------------------------------------------------------------------
const { loadConfig, createPrWorkflow, buildBranchProtectionConfig } = await import(
  pathToFileURL(frameworkDist).href
);

const config = await loadConfig(devexYamlPath);
const prWorkflow = createPrWorkflow(config);
const protection = buildBranchProtectionConfig(prWorkflow, { strict: true });

// ---------------------------------------------------------------------------
// 4. Apply branch protection via GitHub API
// ---------------------------------------------------------------------------
const branch = "main";
const endpoint = `repos/${repo}/branches/${branch}/protection`;

console.log(`\nConfiguring branch protection on ${repo}/${branch}:`);
protection.required_status_checks.contexts.forEach((ctx) =>
  console.log(`  ✓ Required check: "${ctx}"`)
);
console.log(`  ✓ Require branch up to date: ${protection.required_status_checks.strict}`);
console.log();

const json = JSON.stringify(protection);

try {
  execSync(`gh api ${endpoint} --method PUT --input -`, {
    input: json,
    encoding: "utf-8",
    stdio: ["pipe", "inherit", "pipe"],
  });
  console.log(`✓ Branch protection applied. PRs targeting ${branch} now require all checks to pass.`);
} catch (err) {
  const stderr = err instanceof Error ? err.message : String(err);
  console.error(`✗ Failed to apply branch protection:\n${stderr}`);
  console.error(
    "\nIf you see a 403 error, ensure your GitHub token has the `repo` scope and you are an admin or owner of the repository."
  );
  process.exit(1);
}
