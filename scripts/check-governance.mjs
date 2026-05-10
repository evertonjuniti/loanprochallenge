#!/usr/bin/env node
/**
 * Governance check script for the loanprochallenge repository.
 *
 * Uses @loanpro/devex-workflow-framework (built from packages/workflow-framework)
 * to validate branch name, commit messages, and (on PRs) the PR title.
 *
 * Expected environment variables (set by the CI workflow):
 *   BRANCH_NAME  — the feature branch being checked
 *   BASE_SHA     — the commit SHA before the push / PR base commit
 *   HEAD_SHA     — the tip commit SHA of the push / PR head
 *   PR_TITLE     — (optional) pull request title; only set on pull_request events
 */

import { execSync } from "node:child_process";
import {
  validateBranchName,
  validateCommitMessages,
  validatePrTitle,
  DEFAULT_WORK_ID_CONFIG,
} from "../packages/workflow-framework/dist/index.js";

const ZERO_SHA = "0000000000000000000000000000000000000000";

const branch = process.env.BRANCH_NAME ?? "";
const baseSha = process.env.BASE_SHA ?? "";
const headSha = process.env.HEAD_SHA ?? "";
const prTitle = process.env.PR_TITLE ?? "";

let failed = false;

// ---------------------------------------------------------------------------
// 1. Branch name
// ---------------------------------------------------------------------------
const branchResult = validateBranchName(branch, DEFAULT_WORK_ID_CONFIG);
if (!branchResult.valid) {
  console.error(`\n❌ Branch check FAILED\n   ${branchResult.message}`);
  failed = true;
} else {
  console.log(`✅ Branch OK: ${branch} (Work ID: ${branchResult.workId})`);
}

// ---------------------------------------------------------------------------
// 2. Commit messages
// ---------------------------------------------------------------------------
const isInitialPush = !baseSha || baseSha === ZERO_SHA;
if (isInitialPush) {
  console.log("⚠️  Skipping commit message check — initial push on this branch.");
} else {
  let rawLog = "";
  try {
    rawLog = execSync(`git log --format=%s ${baseSha}..${headSha}`, {
      encoding: "utf8",
    }).trim();
  } catch {
    console.error("❌ Failed to read git log. Ensure the repository was checked out with full history.");
    process.exit(1);
  }

  const messages = rawLog ? rawLog.split("\n") : [];

  // Filter out GitHub's auto-generated merge commits (e.g. "Merge <sha> into <sha>")
  // so that PR squash/merge operations don't fail the governance check.
  const filtered = messages.filter((m) => !m.startsWith("Merge "));

  if (filtered.length === 0) {
    console.log("⚠️  No new commits found in range (only merge commits) — skipping commit message check.");
  } else {
    const summary = validateCommitMessages(filtered, DEFAULT_WORK_ID_CONFIG);
    if (summary.violations.length > 0) {
      console.error(`\n❌ Commit message check FAILED (${summary.violations.length}/${summary.total} invalid):`);
      for (const v of summary.violations) {
        console.error(`   • "${v}"`);
      }
      console.error(
        `\n   Expected format: [WORK-ID] Description  (e.g. [DEVEX-42] Add governance check)`
      );
      failed = true;
    } else {
      console.log(`✅ Commit messages OK: ${summary.passed}/${summary.total} passed`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. PR title (only on pull_request events)
// ---------------------------------------------------------------------------
if (prTitle) {
  const titleResult = validatePrTitle(prTitle, DEFAULT_WORK_ID_CONFIG);
  if (!titleResult.valid) {
    console.error(`\n❌ PR title check FAILED\n   ${titleResult.message}`);
    failed = true;
  } else {
    console.log(`✅ PR title OK: "${prTitle}" (Work ID: ${titleResult.workId})`);
  }
}

// ---------------------------------------------------------------------------
// Exit
// ---------------------------------------------------------------------------
if (failed) {
  console.error("\n❌ Governance check failed. See errors above.");
  process.exit(1);
}

console.log("\n✅ All governance checks passed.");
