import type { DevexConfig } from "../../config/devex-config.schema.js";
import { resolveAdapter } from "../../adapters/index.js";
import { checkoutStep, nodeBootstrapSteps } from "../steps.js";
import { toGithubStep } from "../types.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// Small-tests job
//
// Runs the full suite of "fast" tests (unit, property-based, contract, lint)
// without deploying to any environment. Depends on the governance job
// passing, so test results are only produced for convention-compliant code.
//
// The language adapter (resolved from config.runtime.appLanguage) provides
// the setup and test steps. This keeps the workflow generator polyglot:
// the same createPrWorkflow() function produces correct steps for Python,
// TypeScript, Go, etc. without any conditional branching here.
// ---------------------------------------------------------------------------

export interface SmallTestsJobOptions {
  /** Runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
  /** IDs of jobs that must succeed before this job runs. */
  needs?: string[];
}

/**
 * Builds the small-tests job definition for a PR workflow.
 *
 * Uses `resolveAdapter(config)` to select language-specific steps.
 * Throws if no adapter is registered for `config.runtime.appLanguage`.
 */
export function buildSmallTestsJob(
  config: DevexConfig,
  options: SmallTestsJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const adapter = resolveAdapter(config);

  // Convert adapter WorkflowStep[] → GithubStep[] for YAML serialisation.
  const adapterSteps: GithubStep[] = [
    ...adapter.setupSteps(config),
    ...adapter.unitTestSteps(config),
    ...adapter.propertyTestSteps(config),
    ...adapter.contractTestSteps(config),
    ...adapter.lintSteps(config),
  ].map(toGithubStep);

  const job: GithubJob = {
    name: "Small Tests",
    "runs-on": runsOn,
    steps: [
      checkoutStep(),
      // For TypeScript services the adapter's setupSteps already include
      // setup-node + corepack + pnpm install, so we only prepend those for
      // languages whose adapters don't handle Node bootstrap (e.g. Python).
      ...(adapter.name === "python" ? nodeBootstrapSteps() : []),
      ...adapterSteps,
    ],
  };

  if (options.needs && options.needs.length > 0) {
    job.needs = options.needs;
  }

  return job;
}
