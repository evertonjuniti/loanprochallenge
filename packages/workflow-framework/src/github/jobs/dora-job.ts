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
  const dest = "/tmp/_devex_dora_compute.mjs";  return [
    `cat << 'DEVEX_DORA_COMPUTE' > ${dest}`,
    `import {`,
    `  readEventsFromFile,`,
    `  computeDoraMetrics,`,
    `  renderDoraSummaryMarkdown,`,
    `  writeStepSummary,`,
    `} from "@loanpro/devex-workflow-framework";`,
    ``,
    `const events = readEventsFromFile({ outputPath: "dora-events.ndjson" });`,
    `if (events.length === 0) {`,
    `  console.log("No DORA events found — nothing to summarise.");`,
    `  process.exit(0);`,
    `}`,
    ``,
    `// Extract Work ID from the branch name (e.g. feature/FIN-123-foo → FIN-123).`,
    `const branch = process.env.GITHUB_HEAD_REF ?? "";`,
    `const workIdMatch = branch.match(/[A-Z]+-[0-9]+/);`,
    `const workId = workIdMatch ? workIdMatch[0] : null;`,
    ``,
    `const summary = computeDoraMetrics(events);`,
    `const markdown = renderDoraSummaryMarkdown(summary, workId, "pr");`,
    `writeStepSummary(markdown);`,
    `console.log("✓ DORA summary written to step summary.");`,
    `DEVEX_DORA_COMPUTE`,
    `node ${dest}`,
  ].join("\n");
}
