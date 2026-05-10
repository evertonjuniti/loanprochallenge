#!/usr/bin/env node
/**
 * scripts/generate-workflows.mjs
 *
 * Generates GitHub Actions workflow YAML files from the devex.yaml config
 * using @loanpro/devex-workflow-framework's typed PR workflow generator.
 *
 * Usage (from repo root):
 *   node scripts/generate-workflows.mjs
 *
 * Output:
 *   .github/workflows/pr.yml
 *
 * The output file is committed to source control so that GitHub Actions
 * picks it up. Re-run this script whenever devex.yaml or the framework
 * version changes.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const frameworkDist = join(repoRoot, "packages/workflow-framework/dist/index.js");
const devexYamlPath = join(repoRoot, "packages/workflow-framework/devex.yaml");
const outputPath = join(repoRoot, ".github/workflows/pr.yml");

// ---------------------------------------------------------------------------
// 1. Load the framework from the built dist/
// ---------------------------------------------------------------------------
const { loadConfig, createPrWorkflow, renderWorkflowYaml } = await import(
  pathToFileURL(frameworkDist).href
);

// ---------------------------------------------------------------------------
// 2. Load and validate devex.yaml (loadConfig handles YAML parsing)
// ---------------------------------------------------------------------------
const config = await loadConfig(devexYamlPath);

console.log(`✓ Loaded devex.yaml for service: ${config.service.name}`);
console.log(`  runtime:  ${config.runtime.appLanguage} / ${config.runtime.infraFramework}`);
console.log(`  environments: ${Object.keys(config.environments).join(", ")}`);

// ---------------------------------------------------------------------------
// 3. Generate the workflow
// ---------------------------------------------------------------------------
const workflow = createPrWorkflow(config);
const yaml = renderWorkflowYaml(workflow);

// ---------------------------------------------------------------------------
// 4. Write to .github/workflows/pr.yml
// ---------------------------------------------------------------------------
mkdirSync(join(repoRoot, ".github/workflows"), { recursive: true });
writeFileSync(outputPath, yaml, "utf-8");

console.log(`✓ Generated: .github/workflows/pr.yml`);
console.log(`  Jobs: ${Object.keys(workflow.jobs).join(", ")}`);
