import type { DevexConfig } from "../../config/devex-config.schema.js";
import { buildGovernanceJob } from "../jobs/governance-job.js";
import { buildSmallTestsJob } from "../jobs/small-tests-job.js";
import type { GithubJob, GithubWorkflow } from "../types.js";

// ---------------------------------------------------------------------------
// CI workflow generator
//
// createCiWorkflow(config) → GithubWorkflow
//
// Produces a lightweight CI workflow that runs on every push to non-main
// branches. Provides fast feedback on governance and unit/lint correctness
// without triggering a full deployment pipeline.
//
// Job dependency graph:
//
//   governance
//       │
//   small-tests
//
// Intended to run on feature / fix / chore branches during active
// development. The PR workflow handles CDK synth and the Main workflow
// handles full deployment.
// ---------------------------------------------------------------------------

export interface CiWorkflowOptions {
  /** GitHub Actions runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
}

/**
 * Creates a CI workflow object for the given service configuration.
 *
 * Triggers on every push to non-main branches and on `workflow_dispatch`.
 * Runs governance checks followed by the small-tests suite (unit, property,
 * contract, and lint steps provided by the language adapter).
 */
export function createCiWorkflow(
  config: DevexConfig,
  options: CiWorkflowOptions = {}
): GithubWorkflow {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const jobs: Record<string, GithubJob> = {};

  // -------------------------------------------------------------------------
  // 1. Governance — gates everything downstream
  // -------------------------------------------------------------------------
  jobs["governance"] = buildGovernanceJob(config, { runsOn });

  // -------------------------------------------------------------------------
  // 2. Small tests — needs governance
  // -------------------------------------------------------------------------
  jobs["small-tests"] = buildSmallTestsJob(config, {
    runsOn,
    needs: ["governance"],
  });

  return {
    name: "CI",
    on: {
      workflow_dispatch: {},
      push: {
        "branches-ignore": ["main"],
      },
    },
    permissions: {
      contents: "read",
      "pull-requests": "write",
      checks: "write",
    },
    jobs,
  };
}
