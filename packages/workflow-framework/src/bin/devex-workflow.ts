#!/usr/bin/env node
/**
 * devex-workflow — CLI entry point
 *
 * Installed as the `devex-workflow` bin when consuming repos install
 * @loanpro/devex-workflow-framework. Provides subcommands for generating
 * and managing GitHub Actions workflow files.
 *
 * Usage:
 *   pnpm exec devex-workflow generate [--config devex.yaml] [--output-dir .github/workflows]
 *   pnpm exec devex-workflow setup-repo [--config devex.yaml] [--branch main]
 *
 * Or after a global install:
 *   devex-workflow generate
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import {
  loadConfig,
  createCiWorkflow,
  createPrWorkflow,
  createMainWorkflow,
  createSyncWorkflow,
  renderWorkflowYaml,
  buildBranchProtectionConfig,
} from "../index.js";

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const [, , command, ...args] = process.argv;

switch (command) {
  case "generate":
    await runGenerate(args);
    break;
  case "setup-repo":
    await runSetupRepo(args);
    break;
  default:
    console.error(`Unknown command: ${command ?? "(none)"}`);
    console.error("");
    console.error("Usage:");
    console.error("  devex-workflow generate   [--config devex.yaml] [--output-dir .github/workflows]");
    console.error("  devex-workflow setup-repo [--config devex.yaml] [--branch main]");
    process.exit(1);
}

// ---------------------------------------------------------------------------
// generate — regenerates all .github/workflows/*.yml from devex.yaml
// ---------------------------------------------------------------------------

async function runGenerate(args: string[]): Promise<void> {
  const configPath = resolve(getArg(args, "--config") ?? "devex.yaml");
  const outputDir = resolve(getArg(args, "--output-dir") ?? ".github/workflows");

  const config = await loadConfig(configPath);

  console.log(`✓ Loaded config for service: ${config.service.name}`);
  console.log(`  runtime:  ${config.runtime.appLanguage} / ${config.runtime.infraFramework}`);

  mkdirSync(outputDir, { recursive: true });

  const workflows = [
    { name: "ci.yml",         workflow: createCiWorkflow(config)   },
    { name: "pr.yml",         workflow: createPrWorkflow(config)    },
    { name: "main.yml",       workflow: createMainWorkflow(config)  },
    { name: "devex-sync.yml", workflow: createSyncWorkflow(config)  },
  ];

  for (const { name, workflow } of workflows) {
    writeFileSync(join(outputDir, name), renderWorkflowYaml(workflow), "utf-8");
    console.log(`✓ Generated: ${join(outputDir, name)}`);
    console.log(`  Jobs: ${Object.keys(workflow.jobs).join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// setup-repo — applies branch protection via GitHub CLI
// ---------------------------------------------------------------------------

async function runSetupRepo(args: string[]): Promise<void> {
  const configPath = resolve(getArg(args, "--config") ?? "devex.yaml");
  const branch = getArg(args, "--branch") ?? "main";

  // Verify gh CLI is available and authenticated.
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    console.error("✗ GitHub CLI (gh) is not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  // Detect owner/repo from git remote.
  const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
  const ghMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!ghMatch) {
    console.error(`✗ Could not parse a GitHub repository URL from remote: ${remoteUrl}`);
    process.exit(1);
  }
  const repo = ghMatch[1]!;

  const config = await loadConfig(configPath);
  const prWorkflow = createPrWorkflow(config);
  const protection = buildBranchProtectionConfig(prWorkflow, { strict: true });

  console.log(`\nConfiguring branch protection on ${repo}/${branch}:`);
  protection.required_status_checks.contexts.forEach((ctx) =>
    console.log(`  ✓ Required check: "${ctx}"`)
  );

  const json = JSON.stringify(protection);
  try {
    execSync(`gh api repos/${repo}/branches/${branch}/protection --method PUT --input -`, {
      input: json,
      encoding: "utf-8",
      stdio: ["pipe", "inherit", "pipe"],
    });
    console.log(`\n✓ Branch protection applied. PRs targeting ${branch} now require all checks to pass.`);
  } catch (err) {
    const stderr = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to apply branch protection:\n${stderr}`);
    process.exit(1);
  }
}
