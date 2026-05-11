#!/usr/bin/env node
/**
 * scripts/install-hooks.mjs
 *
 * Points git at the committed .githooks/ directory so the pre-push
 * validation script runs automatically before every `git push`.
 *
 * Run once after cloning (from repo root):
 *   node scripts/install-hooks.mjs
 *
 * What it does:
 *   git config core.hooksPath .githooks
 *
 * Note: the hook scripts in .githooks/ are committed to the repository and
 * were generated via `devex hooks install --shared` in packages/cli.
 * That command renders hooks from Jinja2 templates using devex.yaml settings
 * and writes them to .githooks/ instead of the local-only .git/hooks/.
 * Re-run it with --force to regenerate after devex.yaml changes:
 *
 *   cd packages/cli
 *   uv run devex hooks install \
 *     --config ../workflow-framework/devex.yaml \
 *     --shared --force
 *
 * To uninstall:
 *   git config --unset core.hooksPath
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const hooksDir = join(repoRoot, ".githooks");

if (!existsSync(hooksDir)) {
  console.error("✗ .githooks/ directory not found. Are you running this from the repo root?");
  process.exit(1);
}

execSync("git config core.hooksPath .githooks", { cwd: repoRoot, stdio: "inherit" });

console.log("✓ Git hooks path set to .githooks/");
console.log("  Pre-push validation will run automatically before every `git push`.");
console.log("");
console.log("  Hooks installed:");
console.log("    • pre-push — workflow-framework (typecheck, lint, tests) + cli (ruff, pytest)");
console.log("");
console.log("  To skip in an emergency: git push --no-verify");
