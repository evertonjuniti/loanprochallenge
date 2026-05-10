import type { GithubWorkflow } from "./types.js";

// ---------------------------------------------------------------------------
// Branch protection configuration
//
// Derives the required GitHub Actions check contexts from a PR workflow so
// that branch protection rules can be configured to block merges until all
// PR checks pass.
//
// Each GitHub Actions job reports a check whose context name is:
//   "{workflow.name} / {job.name}"
//
// This module provides helpers to compute those names from a GithubWorkflow
// object and to build the GitHub API payload for branch protection.
// ---------------------------------------------------------------------------

/** GitHub API payload for PUT /repos/{owner}/{repo}/branches/{branch}/protection */
export interface BranchProtectionConfig {
  required_status_checks: {
    /** When true, require branches to be up to date before merging. */
    strict: boolean;
    /** List of status check contexts that must pass before merging. */
    contexts: string[];
  };
  enforce_admins: boolean;
  required_pull_request_reviews: null;
  restrictions: null;
}

/**
 * Derives the list of required GitHub Actions check contexts from a PR
 * workflow object.
 *
 * Only jobs without an `if` condition are included — unconditional jobs
 * (e.g. `always()` DORA jobs) are skipped since their result does not
 * indicate code quality.
 *
 * @param prWorkflow - The GithubWorkflow returned by `createPrWorkflow()`.
 * @returns Array of check context strings in "{workflowName} / {jobName}" format.
 */
export function buildRequiredChecks(prWorkflow: GithubWorkflow): string[] {
  return Object.values(prWorkflow.jobs)
    .filter((job) => job.if == null && job.name != null)
    .map((job) => `${prWorkflow.name} / ${job.name!}`);
}

/**
 * Builds a GitHub branch protection configuration object that requires all
 * unconditional PR workflow jobs to pass before a PR can be merged.
 *
 * The returned object is ready to be serialised and sent to:
 *   PUT /repos/{owner}/{repo}/branches/{branch}/protection
 *
 * @param prWorkflow - The GithubWorkflow returned by `createPrWorkflow()`.
 * @param options.strict - Require branches to be up to date before merging. Defaults to `true`.
 */
export function buildBranchProtectionConfig(
  prWorkflow: GithubWorkflow,
  options: { strict?: boolean } = {}
): BranchProtectionConfig {
  return {
    required_status_checks: {
      strict: options.strict ?? true,
      contexts: buildRequiredChecks(prWorkflow),
    },
    enforce_admins: false,
    required_pull_request_reviews: null,
    restrictions: null,
  };
}
