import type { DevexConfig } from "../../config/devex-config.schema.js";
import { resolveAdapters } from "../../adapters/index.js";
import { checkoutStep } from "../steps.js";
import { toGithubStep } from "../types.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// Small-tests job
//
// Runs the full suite of "fast" tests (unit, property-based, contract, lint)
// without deploying to any environment. Depends on the governance job
// passing, so test results are only produced for convention-compliant code.
//
// The language adapter(s) (resolved from config.runtime.appLanguage) provide
// the setup and test steps. When appLanguage is an array, steps from all
// adapters are concatenated — supporting polyglot monorepos without any
// conditional branching in the workflow generators.
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
 * Uses `resolveAdapters(config)` to select language-specific steps.
 * When `appLanguage` is an array (polyglot repo), each adapter's steps are
 * appended in declaration order.
 * Throws if any language has no registered adapter.
 */
export function buildSmallTestsJob(
  config: DevexConfig,
  options: SmallTestsJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const adapters = resolveAdapters(config);

  // Merge steps from every adapter in declaration order.
  const adapterSteps: GithubStep[] = adapters.flatMap((adapter) => [
    ...adapter.setupSteps(config),
    ...adapter.unitTestSteps(config),
    ...adapter.propertyTestSteps(config),
    ...adapter.contractTestSteps(config),
    ...adapter.lintSteps(config),
  ]).map(toGithubStep);

  // Each adapter's setupSteps() installs its own runtime (Node/pnpm for
  // TypeScript, Python/uv for Python, etc.). No shared bootstrap is prepended
  // here — adding Node.js steps for a pure Python repo would cause
  // `pnpm install` to fail when there is no package.json at the repo root.
  const job: GithubJob = {
    name: "Small Tests",
    "runs-on": runsOn,
    steps: [
      checkoutStep(),
      ...adapterSteps,
    ],
  };

  if (options.needs && options.needs.length > 0) {
    job.needs = options.needs;
  }

  return job;
}
