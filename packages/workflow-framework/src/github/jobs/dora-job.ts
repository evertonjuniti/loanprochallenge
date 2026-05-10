import type { DevexConfig } from "../../config/devex-config.schema.js";
import { checkoutStep, nodeBootstrapSteps } from "../steps.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// DORA & Audit job
//
// The final job in every PR pipeline. Runs after all deploy jobs complete
// (even if some failed) to ensure telemetry is always captured.
//
// Responsibilities:
//   1. Downloads the audit event NDJSON artifacts uploaded by each deploy job.
//   2. Computes DORA metrics from the collected events.
//   3. Writes a human-readable Markdown summary to the GitHub step summary.
//   4. Re-uploads the consolidated NDJSON file as a single artifact.
//
// The consolidated artifact can be picked up by downstream systems (S3,
// CloudWatch, EventBridge) for long-term DORA metric storage.
// ---------------------------------------------------------------------------

export interface DoraAuditJobOptions {
  /** Runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
  /** IDs of jobs that must succeed (or fail) before this job runs. */
  needs?: string[];
}

/**
 * Builds the DORA & Audit job definition for a PR workflow.
 *
 * Always runs (`if: always()`) so telemetry is captured even when
 * deployment jobs fail — partial DORA data is still useful.
 */
export function buildDoraAuditJob(
  _config: DevexConfig,
  options: DoraAuditJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";

  const steps: GithubStep[] = [
    checkoutStep(),
    ...nodeBootstrapSteps(),
    {
      name: "Download audit event artifacts",
      uses: "actions/download-artifact@v4",
      with: {
        // Collects audit-events-sandbox, audit-events-staging, etc.
        pattern: "audit-events-*",
        "merge-multiple": "true",
        path: ".",
      },
      // Non-fatal: the DORA job still writes a summary even if no artifacts exist.
      "continue-on-error": true,
    },
    {
      name: "Compute DORA metrics and write step summary",
      env: {
        // Used to extract the Work ID for the summary heading.
        GITHUB_HEAD_REF: "${{ github.head_ref || '' }}",
      },
      run: doraComputeScript(),
    },
    {
      name: "Upload consolidated DORA events",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: "dora-events",
        path: "dora-events.ndjson",
        "if-no-files-found": "ignore",
      },
    },
  ];

  const job: GithubJob = {
    name: "DORA & Audit",
    "runs-on": runsOn,
    if: "always()",
    steps,
  };

  if (options.needs && options.needs.length > 0) {
    job.needs = options.needs;
  }

  return job;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function doraComputeScript(): string {
  return [
    `node --input-type=module << 'DEVEX_DORA_COMPUTE'`,
    `import { existsSync, readFileSync, appendFileSync } from "node:fs";`,
    `import { resolve } from "node:path";`,
    `const outputPath = resolve("dora-events.ndjson");`,
    `if (!existsSync(outputPath)) { console.log("No DORA events found — nothing to summarise."); process.exit(0); }`,
    `const content = readFileSync(outputPath, "utf-8");`,
    `const events = content.split("\\n").filter(l => l.trim().length > 0).map(l => JSON.parse(l));`,
    `if (events.length === 0) { console.log("No DORA events found — nothing to summarise."); process.exit(0); }`,
    `const branch = process.env.GITHUB_HEAD_REF ?? "";`,
    `const workIdMatch = branch.match(/[A-Z]+-[0-9]+/);`,
    `const workId = workIdMatch ? workIdMatch[0] : null;`,
    `const prodDeps = events.filter(e => e.environment === "production" && (e.doraEventType === "deployment_succeeded" || e.doraEventType === "deployment_failed" || e.doraEventType === "deployment_rolled_back"));`,
    `const deploymentCount = prodDeps.filter(e => e.doraEventType === "deployment_succeeded").length;`,
    `const failedDeploymentCount = prodDeps.filter(e => e.doraEventType === "deployment_failed" || e.doraEventType === "deployment_rolled_back").length;`,
    `const total = deploymentCount + failedDeploymentCount;`,
    `const changeFailureRate = total > 0 ? failedDeploymentCount / total : 0;`,
    `const leadTimes = prodDeps.filter(e => typeof e.leadTimeSeconds === "number").map(e => e.leadTimeSeconds);`,
    `const avgLead = leadTimes.length > 0 ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length : null;`,
    `const leadTimeDisplay = avgLead != null ? (avgLead / 3600).toFixed(1) + "h avg" : "N/A (firstCommitAt not set)";`,
    `const cfrPercent = (changeFailureRate * 100).toFixed(1);`,
    `const markdown = [`,
    `  "## DORA Metrics Summary", "",`,
    `  "| Metric | Value |", "|---|---|",`,
    `  "| Work ID | " + (workId ?? "N/A") + " |",`,
    `  "| Environment | pr |",`,
    `  "| Successful Deployments | " + deploymentCount + " |",`,
    `  "| Failed / Rolled Back | " + failedDeploymentCount + " |",`,
    `  "| Change Failure Rate | " + cfrPercent + "% |",`,
    `  "| Lead Time for Changes | " + leadTimeDisplay + " |",`,
    `  "",`,
    `].join("\\n");`,
    `const summaryPath = process.env["GITHUB_STEP_SUMMARY"];`,
    `if (summaryPath) { appendFileSync(resolve(summaryPath), markdown + "\\n", "utf-8"); }`,
    `console.log("✓ DORA summary written to step summary.");`,
    `DEVEX_DORA_COMPUTE`,
  ].join("\n");
}
