import type { DevexConfig } from "../../config/devex-config.schema.js";
import { buildGovernanceJob } from "../jobs/governance-job.js";
import { buildSmallTestsJob } from "../jobs/small-tests-job.js";
import { buildCdkSynthJob } from "../jobs/cdk-synth-job.js";
import { buildDeployJob } from "../jobs/deploy-job.js";
import { buildDoraAuditJob } from "../jobs/dora-job.js";
import type { GithubJob, GithubWorkflow } from "../types.js";

// ---------------------------------------------------------------------------
// Main-branch workflow generator
//
// createMainWorkflow(config) → GithubWorkflow
//
// Produces the full Golden Path pipeline that runs after a PR merges to the
// main branch. Executes the complete sequence of jobs so that every merge
// results in a production deployment with full DORA telemetry.
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

export interface MainWorkflowOptions {
  /** GitHub Actions runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
}

/**
 * Creates a complete Main-branch workflow object for the given service config.
 *
 * Triggers on push to the `main` branch (tags ignored) and `workflow_dispatch`.
 * Runs the full Golden Path: governance → tests → CDK synth → sequential
 * environment deployments → DORA/audit summary.
 */
export function createMainWorkflow(
  config: DevexConfig,
  options: MainWorkflowOptions = {}
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
    const needs =
      previousJobId !== undefined ? [previousJobId] : initialDeployNeeds;

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
    name: "Main",
    on: {
      workflow_dispatch: {},
      push: {
        branches: ["main"],
        "tags-ignore": ["**"],
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
