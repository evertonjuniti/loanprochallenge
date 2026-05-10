#!/usr/bin/env node
/**
 * scripts/generate-workflows.mjs
 *
 * Generates GitHub Actions workflow YAML files from the devex.yaml config
 * using @loanpro/devex-workflow-framework's typed workflow generators.
 *
 * Usage (from repo root):
 *   node scripts/generate-workflows.mjs
 *
 * Output:
 *   .github/workflows/ci.yml    — governance + small-tests (push to non-main)
 *   .github/workflows/pr.yml    — governance + small-tests + cdk-synth (pull_request)
 *   .github/workflows/main.yml  — full pipeline incl. deploy + DORA (push to main)
 *
 * The output files are committed to source control so that GitHub Actions
 * picks them up. Re-run this script whenever devex.yaml or the framework
 * version changes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const frameworkDist = join(repoRoot, "packages/workflow-framework/dist/index.js");
const devexYamlPath = join(repoRoot, "packages/workflow-framework/devex.yaml");
const workflowsDir = join(repoRoot, ".github/workflows");

// ---------------------------------------------------------------------------
// 1. Load the framework from the built dist/
// ---------------------------------------------------------------------------
const {
  loadConfig,
  createCiWorkflow,
  createPrWorkflow,
  createMainWorkflow,
  createSyncWorkflow,
  renderWorkflowYaml,
} = await import(pathToFileURL(frameworkDist).href);

// ---------------------------------------------------------------------------
// 2. Load and validate devex.yaml (loadConfig handles YAML parsing)
// ---------------------------------------------------------------------------
const config = await loadConfig(devexYamlPath);

console.log(`✓ Loaded devex.yaml for service: ${config.service.name}`);
console.log(`  runtime:  ${config.runtime.appLanguage} / ${config.runtime.infraFramework}`);
console.log(`  environments: ${Object.keys(config.environments).join(", ")}`);

// ---------------------------------------------------------------------------
// 3. Generate the workflows
// ---------------------------------------------------------------------------
mkdirSync(workflowsDir, { recursive: true });

const workflows = [
  { name: "ci.yml",         creator: createCiWorkflow   },
  { name: "pr.yml",         creator: createPrWorkflow    },
  { name: "main.yml",       creator: createMainWorkflow  },
  { name: "devex-sync.yml", creator: createSyncWorkflow  },
];

for (const { name, creator } of workflows) {
  const workflow = creator(config);
  const yaml = renderWorkflowYaml(workflow);
  const outputPath = join(workflowsDir, name);
  writeFileSync(outputPath, yaml, "utf-8");
  console.log(`✓ Generated: .github/workflows/${name}`);
  console.log(`  Jobs: ${Object.keys(workflow.jobs).join(", ")}`);
}
