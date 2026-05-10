import type { DevexConfig } from "../../config/devex-config.schema.js";
import { checkoutStep, enableCorepackStep, installNodeDepsStep, setupNodeStep } from "../steps.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// CDK synth job
//
// Validates that the CDK infrastructure compiles and synthesises correctly
// without deploying anything. Runs after small-tests to avoid wasting
// synthesis time when application tests are already failing.
//
// Only included in the generated workflow when
//   config.runtime.infraFramework === "aws-cdk-typescript"
// The createPrWorkflow() orchestrator is responsible for this guard.
// ---------------------------------------------------------------------------

export interface CdkSynthJobOptions {
  /** Runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
  /** IDs of jobs that must succeed before this job runs. */
  needs?: string[];
}

/**
 * Builds the CDK synth job definition for a PR workflow.
 *
 * Reads CDK configuration (working directory, synth command) from
 * `config.ci.cdk`, falling back to sensible defaults when absent.
 */
export function buildCdkSynthJob(
  config: DevexConfig,
  options: CdkSynthJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const cdk = config.ci?.cdk;
  const workDir = cdk?.workingDirectory ?? "infra";
  const synthCmd = cdk?.synthCommand ?? "pnpm cdk synth";

  const steps: GithubStep[] = [
    checkoutStep(),
    setupNodeStep(),
    enableCorepackStep(),
    installNodeDepsStep(workDir),
    {
      name: "CDK synth",
      run: synthCmd,
      "working-directory": workDir,
    },
  ];

  const job: GithubJob = {
    name: "CDK Synth",
    "runs-on": runsOn,
    steps,
  };

  if (options.needs && options.needs.length > 0) {
    job.needs = options.needs;
  }

  return job;
}
