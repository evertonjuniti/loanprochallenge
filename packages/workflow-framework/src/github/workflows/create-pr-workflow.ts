import { stringify } from "yaml";
import type { DevexConfig } from "../../config/devex-config.schema.js";
import { buildGovernanceJob } from "../jobs/governance-job.js";
import { buildSmallTestsJob } from "../jobs/small-tests-job.js";
import { buildCdkSynthJob } from "../jobs/cdk-synth-job.js";
import { buildDeployJob } from "../jobs/deploy-job.js";
import { buildDoraAuditJob } from "../jobs/dora-job.js";
import type { GithubJob, GithubWorkflow } from "../types.js";

// ---------------------------------------------------------------------------
// PR workflow generator
//
// createPrWorkflow(config) → GithubWorkflow
//
// Produces a complete, ready-to-serialise GitHub Actions workflow object for
// the PR pipeline of a service whose configuration lives in devex.yaml.
//
// Job dependency graph:
//
//   governance
//       │
//   small-tests
//       │
//   cdk-synth  ← only when infraFramework === "aws-cdk-typescript"
//       │
//   deploy-<env1>  ← one job per environment, in devex.yaml order
//       │
//   deploy-<env2>
//       │
//   deploy-<envN>
//       │
//   dora-audit  ← always() — captures telemetry even on partial failure
//
// ---------------------------------------------------------------------------

export interface PrWorkflowOptions {
  /** GitHub Actions runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
}

/**
 * Creates a complete PR workflow object for the given service configuration.
 *
 * The workflow triggers on `pull_request` events and runs the full Golden
 * Path pipeline: governance → tests → CDK synth → sequential environment
 * deployments → DORA/audit summary.
 *
 * @example
 * import { loadConfig, createPrWorkflow, renderWorkflowYaml } from "@loanpro/devex-workflow-framework";
 * const config = await loadConfig();
 * const workflow = createPrWorkflow(config);
 * const yaml = renderWorkflowYaml(workflow);
 * writeFileSync(".github/workflows/pr.yml", yaml);
 */
export function createPrWorkflow(
  config: DevexConfig,
  options: PrWorkflowOptions = {}
): GithubWorkflow {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const hasCdk = config.runtime.infraFramework === "aws-cdk-typescript";

  const jobs: Record<string, GithubJob> = {};

  // -------------------------------------------------------------------------
  // 1. Governance — no dependencies, gates everything downstream
  // -------------------------------------------------------------------------
  jobs["governance"] = buildGovernanceJob(config, { runsOn });

  // -------------------------------------------------------------------------
  // 2. Small tests — needs governance
  // -------------------------------------------------------------------------
  jobs["small-tests"] = buildSmallTestsJob(config, {
    runsOn,
    needs: ["governance"],
  });

  // -------------------------------------------------------------------------
  // 3. CDK synth — needs small-tests (only for CDK services)
  // -------------------------------------------------------------------------
  if (hasCdk) {
    jobs["cdk-synth"] = buildCdkSynthJob(config, {
      runsOn,
      needs: ["small-tests"],
    });
  }

  // -------------------------------------------------------------------------
  // 4. Deploy jobs — one per environment, chained sequentially
  //
  // The first deploy job depends on cdk-synth (or small-tests when no CDK).
  // Each subsequent deploy job depends on the previous one so that
  //   sandbox → staging → production is enforced.
  // -------------------------------------------------------------------------
  const initialDeployNeeds = hasCdk ? ["cdk-synth"] : ["small-tests"];
  const envEntries = Object.entries(config.environments);
  const deployJobIds: string[] = [];
  let previousJobId: string | undefined;

  for (const [envName, envConfig] of envEntries) {
    const jobId = `deploy-${envName}`;
    const needs = previousJobId !== undefined ? [previousJobId] : initialDeployNeeds;

    jobs[jobId] = buildDeployJob(envName, envConfig, config, { runsOn, needs });
    deployJobIds.push(jobId);
    previousJobId = jobId;
  }

  // -------------------------------------------------------------------------
  // 5. DORA & Audit — needs only the LAST deploy job (if: always())
  //
  // Depending on the last job is sufficient because the deploy chain is
  // sequential: production already implies sandbox → staging ran.
  // With `if: always()`, DORA also runs when any upstream job is skipped.
  // -------------------------------------------------------------------------
  const lastDeployJobId = deployJobIds.at(-1);
  const doraNeeds =
    lastDeployJobId !== undefined
      ? [lastDeployJobId]
      : hasCdk
        ? ["cdk-synth"]
        : ["small-tests"];

  jobs["dora-audit"] = buildDoraAuditJob(config, { runsOn, needs: doraNeeds });

  return {
    name: `DevEx PR Pipeline — ${config.service.name}`,
    on: {
      workflow_dispatch: {},
      pull_request: {
        types: [
          "opened",
          "synchronize",
          "reopened",
          "ready_for_review",
          "edited",
        ],
      },
    },
    permissions: {
      contents: "read",
      "pull-requests": "write",
      checks: "write",
      "id-token": "write",
    },
    jobs,
  };
}

/**
 * Serialises a GithubWorkflow object to a YAML string.
 *
 * Prepends a machine-generated header so service teams know not to edit the
 * file manually and can identify the correct regeneration command.
 *
 * Multi-line `run:` strings (e.g. inline Node.js scripts) are rendered as
 * YAML literal block scalars (`|`) automatically by the yaml library.
 */
export function renderWorkflowYaml(workflow: GithubWorkflow): string {
  const header = [
    "# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json",
    "#",
    "# This file was generated by @loanpro/devex-workflow-framework.",
    "# Do not edit manually — regenerate with:",
    "#   node scripts/generate-workflows.mjs",
    "",
    "",
  ].join("\n");

  return header + stringify(workflow, { lineWidth: 0 });
}
