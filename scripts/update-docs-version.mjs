#!/usr/bin/env node
/**
 * scripts/update-docs-version.mjs
 *
 * Replaces hard-coded framework version strings in README files with the
 * version declared in packages/workflow-framework/package.json.
 *
 * Two substitution patterns are handled:
 *   1. v-prefixed semver tag:  v0.3.0  →  v<version>   (git refs, YAML `ref:` fields)
 *   2. Raw semver (npm style): @0.3.0  →  @<version>   (npm/pnpm registry install)
 *
 * Called automatically by scripts/generate-workflows.mjs so that running
 *   node scripts/generate-workflows.mjs
 * keeps both workflow YAML files AND README version references up-to-date.
 *
 * Can also be run standalone:
 *   node scripts/update-docs-version.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// ---------------------------------------------------------------------------
// 1. Read the current package version
// ---------------------------------------------------------------------------
const packageJsonPath = join(repoRoot, "packages/workflow-framework/package.json");
const { version: pkgVersion } = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

// ---------------------------------------------------------------------------
// 2. Paths of README files that contain version references
// ---------------------------------------------------------------------------
const README_PATHS = [
  join(repoRoot, "README.md"),
  join(repoRoot, "docs/contribution-guidelines.md"),
  join(repoRoot, "packages/cli/README.md"),
  join(repoRoot, "packages/workflow-framework/README.md"),
];

// ---------------------------------------------------------------------------
// 3. Replace version strings and report changes
//
// Patterns are anchored to specific contexts so that only framework version
// references are updated — not other package versions (e.g. devex-cli 0.1.0).
// ---------------------------------------------------------------------------
const VERSION_PATTERNS = [
  // git tag ref in URL:  #v0.3.0
  [/#v\d+\.\d+\.\d+/g, `#v${pkgVersion}`],
  // GitHub Actions ref:  @v0.3.0  (but not @v for actions like @v4)
  [/(@loanpro[^@\s]*?)@v\d+\.\d+\.\d+/g, `$1@v${pkgVersion}`],
  // workflow/pr.yml@v0.3.0  (reusable workflow call refs)
  [/(\.github\/workflows\/[^@]+)@v\d+\.\d+\.\d+/g, `$1@v${pkgVersion}`],
  // YAML ref field:  ref: v0.3.0
  [/(ref:\s+)v\d+\.\d+\.\d+/g, `$1v${pkgVersion}`],
  // CLI flag value:  --workflow-version v0.3.0
  [/(--workflow-version\s+)v\d+\.\d+\.\d+/g, `$1v${pkgVersion}`],
  // Flag example:  (e.g. v0.3.0)
  [/(e\.g\.\s+)v\d+\.\d+\.\d+/g, `$1v${pkgVersion}`],
  // npm/pnpm registry:  @loanpro/devex-workflow-framework@0.3.0  (no v prefix)
  [/(@loanpro\/devex-workflow-framework)@\d+\.\d+\.\d+/g, `$1@${pkgVersion}`],
  // Markdown inline badge:  `@loanpro/devex-workflow-framework` v0.3.0
  [/(`@loanpro\/devex-workflow-framework`\s+)v\d+\.\d+\.\d+/g, `$1v${pkgVersion}`],
];

let anyUpdated = false;

for (const filePath of README_PATHS) {
  const original = readFileSync(filePath, "utf-8");

  let updated = original;
  for (const [pattern, replacement] of VERSION_PATTERNS) {
    updated = updated.replace(pattern, replacement);
  }

  if (updated === original) {
    console.log(`  (no version changes) ${relative(repoRoot, filePath)}`);
    continue;
  }

  writeFileSync(filePath, updated, "utf-8");
  anyUpdated = true;
  console.log(`✓ Updated version references: ${relative(repoRoot, filePath)}`);
}

if (!anyUpdated) {
  console.log(`  All README files already reference v${pkgVersion}.`);
}
