import type { GithubStep } from "./types.js";

// ---------------------------------------------------------------------------
// Shared step factories
//
// These produce the common "boilerplate" steps that appear in multiple jobs
// (checkout, Node.js setup, pnpm bootstrap). Centralising them keeps job
// builders concise and ensures consistency across generated workflows.
// ---------------------------------------------------------------------------

/**
 * Checks out the calling repository.
 *
 * @param fullHistory - When true, fetches the complete git history
 *   (`fetch-depth: 0`). Required for the governance job to read commit
 *   ranges. Other jobs use the default shallow clone.
 */
export function checkoutStep(fullHistory = false): GithubStep {
  const step: GithubStep = {
    name: "Checkout",
    uses: "actions/checkout@v4",
  };
  if (fullHistory) {
    step.with = { "fetch-depth": 0 };
  }
  return step;
}

/** Sets up Node.js via `actions/setup-node@v4`. */
export function setupNodeStep(nodeVersion = "24"): GithubStep {
  return {
    name: "Set up Node.js",
    uses: "actions/setup-node@v4",
    with: { "node-version": nodeVersion },
  };
}

/** Activates the pnpm shim that ships with Node.js ≥ 16.9 via corepack. */
export function enableCorepackStep(): GithubStep {
  return {
    name: "Enable corepack (pnpm)",
    run: "corepack enable",
  };
}

/** Installs Node.js dependencies from the lockfile (reproducible builds). */
export function installNodeDepsStep(workingDirectory?: string): GithubStep {
  const step: GithubStep = {
    name: "Install dependencies",
    run: "pnpm install --frozen-lockfile",
  };
  if (workingDirectory !== undefined) {
    step["working-directory"] = workingDirectory;
  }
  return step;
}

/** Standard Node.js bootstrap: setup-node → corepack → pnpm install. */
export function nodeBootstrapSteps(options?: {
  nodeVersion?: string;
  workingDirectory?: string;
}): GithubStep[] {
  return [
    setupNodeStep(options?.nodeVersion),
    enableCorepackStep(),
    installNodeDepsStep(options?.workingDirectory),
  ];
}
