import type { DevexConfig } from "../../config/devex-config.schema.js";
import type { GithubJob, GithubWorkflow } from "../types.js";

// ---------------------------------------------------------------------------
// Sync workflow generator
//
// createSyncWorkflow(config) → GithubWorkflow
//
// Produces a `devex-sync.yml` workflow that consuming repos commit once.
// When triggered, it:
//   1. Updates @loanpro/devex-workflow-framework to a specified version.
//   2. Runs `pnpm exec devex-workflow generate` (the published CLI bin).
//   3. Opens a PR with the regenerated workflow files.
//
// Customisation boundary:
//   devex.yaml is NEVER modified by the sync — it is the source of all
//   service-specific configuration. Generated workflow files (.github/
//   workflows/*.yml) are replaced on every sync run.
//
// Governance compliance:
//   The workflow_dispatch inputs include a `ticket_id` field whose value is
//   embedded in the branch name, PR title, and commit message so that the
//   governance job's Work ID checks pass on the resulting PR.
// ---------------------------------------------------------------------------

export interface SyncWorkflowOptions {
  /** GitHub Actions runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
  /** npm package name to update. Defaults to "@loanpro/devex-workflow-framework". */
  packageName?: string;
}

/**
 * Creates a DevEx sync workflow object.
 *
 * Commit this file to `.github/workflows/devex-sync.yml` in any repo that
 * uses `@loanpro/devex-workflow-framework`. When triggered via
 * `workflow_dispatch`, it bumps the framework version, regenerates all
 * workflow YAML files, and opens a PR.
 *
 * @example
 * // In generate-workflows.mjs of a consuming repo:
 * const sync = createSyncWorkflow(config);
 * writeFileSync(".github/workflows/devex-sync.yml", renderWorkflowYaml(sync));
 */
export function createSyncWorkflow(
  _config: DevexConfig,
  options: SyncWorkflowOptions = {}
): GithubWorkflow {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const packageName = options.packageName ?? "@loanpro/devex-workflow-framework";

  const jobs: Record<string, GithubJob> = {
    sync: {
      name: "Sync DevEx Workflows",
      "runs-on": runsOn,
      permissions: {
        contents: "write",
        "pull-requests": "write",
      },
      steps: [
        {
          name: "Checkout",
          uses: "actions/checkout@v4",
        },
        {
          name: "Set up Node.js",
          uses: "actions/setup-node@v4",
          with: { "node-version": "24" },
        },
        {
          name: "Enable corepack (pnpm)",
          run: "corepack enable",
        },
        {
          name: "Install current dependencies",
          run: "pnpm install --no-frozen-lockfile",
        },
        {
          name: `Update ${packageName}`,
          env: {
            VERSION: "${{ inputs.version }}",
          },
          run: [
            `if [ "$VERSION" = "latest" ]; then`,
            `  pnpm add ${packageName}@latest --save-dev`,
            `else`,
            `  pnpm add "${packageName}@$VERSION" --save-dev`,
            `fi`,
          ].join("\n"),
        },
        {
          name: "Regenerate workflow files",
          run: "pnpm exec devex-workflow generate",
        },
        {
          name: "Open PR with updated workflows",
          uses: "peter-evans/create-pull-request@v7",
          with: {
            token: "${{ secrets.GITHUB_TOKEN }}",
            branch: "chore/${{ inputs.ticket_id }}-sync-devex-workflows",
            title: "[${{ inputs.ticket_id }}] chore: sync DevEx workflow definitions",
            body: [
              "Automated sync of generated workflow files from `" + packageName + "`.",
              "",
              "| | |",
              "|---|---|",
              "| **Framework version** | `${{ inputs.version }}` |",
              "| **Triggered by** | @${{ github.actor }} |",
              "| **Custom config** | `devex.yaml` is unchanged — all service customisation is preserved |",
              "",
              "**Files regenerated:** `ci.yml`, `pr.yml`, `main.yml`, `devex-sync.yml`",
            ].join("\n"),
            "commit-message":
              "[${{ inputs.ticket_id }}] chore: sync DevEx workflow definitions",
            labels: "automated,devex",
          },
        },
      ],
    },
  };

  return {
    name: "Sync DevEx Workflows",
    on: {
      workflow_dispatch: {
        inputs: {
          version: {
            description: `Version of ${packageName} to update to (e.g. "0.3.0" or "latest")`,
            required: false,
            default: "latest",
          },
          ticket_id: {
            description:
              "Work ticket ID for governance compliance (e.g. DEVEX-42). Required to pass PR checks.",
            required: true,
          },
        },
      },
    },
    jobs,
  };
}
