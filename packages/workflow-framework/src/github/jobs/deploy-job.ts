import type { DevexConfig } from "../../config/devex-config.schema.js";
import { checkoutStep, enableCorepackStep, installNodeDepsStep, setupNodeStep } from "../steps.js";
import type { GithubJob, GithubStep } from "../types.js";

// ---------------------------------------------------------------------------
// Deploy job (per environment)
//
// Each environment defined in devex.yaml gets its own job so that GitHub
// Actions can enforce environment-level protection rules, required reviewers,
// and deployment history independently per environment.
//
// Deployment jobs run sequentially (sandbox → staging → production) because
// production deployments should only proceed after staging is verified.
//
// Each job:
//   1. Configures AWS credentials via GitHub OIDC (no long-lived secrets).
//   2. Runs CDK deploy for the environment's stack.
//   3. Emits a deployment audit event (success or failure) to NDJSON.
//   4. Uploads the audit file as a GitHub Actions artifact for the DORA job.
// ---------------------------------------------------------------------------

/** Shape of a single entry from config.environments. */
type EnvironmentConfig = DevexConfig["environments"][string];

export interface DeployJobOptions {
  /** Runner label. Defaults to "ubuntu-latest". */
  runsOn?: string;
  /** IDs of jobs that must succeed before this job runs. */
  needs?: string[];
}

/**
 * Builds a deploy job definition for a single environment.
 *
 * @param envName   - Key from `config.environments` (e.g. "sandbox").
 * @param envConfig - Value for that key (CDK stack, region, GitHub env, …).
 * @param config    - Full DevexConfig for CDK command configuration.
 * @param options   - Runner and dependency options.
 */
export function buildDeployJob(
  envName: string,
  envConfig: EnvironmentConfig,
  config: DevexConfig,
  options: DeployJobOptions = {}
): GithubJob {
  const runsOn = options.runsOn ?? "ubuntu-latest";
  const cdk = config.ci?.cdk;
  const workDir = cdk?.workingDirectory ?? "infra";
  const deployCmd = cdk?.deployCommand ?? "pnpm cdk deploy --require-approval never";
  const region = envConfig.awsRegion;
  const stack = envConfig.cdkStack;

  // The role ARN can be supplied directly in devex.yaml or resolved from a
  // GitHub secret whose name encodes the environment name.
  const roleArn =
    envConfig.roleArn ??
    `\${{ secrets.AWS_DEPLOY_ROLE_ARN_${envName.toUpperCase()} }}`;

  const steps: GithubStep[] = [
    checkoutStep(),
    {
      id: "check-infra-dir",
      name: "Check infra directory exists",
      run: [
        `if [ ! -d "${workDir}" ]; then`,
        `  echo "::warning::CDK working directory '${workDir}' not found — skipping deployment (infrastructure not yet initialised)."`,
        `  echo "skip=true" >> "$GITHUB_OUTPUT"`,
        `fi`,
      ].join("\n"),
    },
    {
      ...setupNodeStep(),
      if: `steps.check-infra-dir.outputs.skip != 'true'`,
    },
    {
      ...enableCorepackStep(),
      if: `steps.check-infra-dir.outputs.skip != 'true'`,
    },
    {
      ...installNodeDepsStep(workDir),
      if: `steps.check-infra-dir.outputs.skip != 'true'`,
    },
    {
      name: "Configure AWS credentials (OIDC)",
      if: `steps.check-infra-dir.outputs.skip != 'true'`,
      uses: "aws-actions/configure-aws-credentials@v4",
      with: {
        "role-to-assume": roleArn,
        "aws-region": region,
      },
    },
    {
      id: "cdk-deploy",
      name: `Deploy to ${envName}`,
      if: `steps.check-infra-dir.outputs.skip != 'true'`,
      run: `${deployCmd} ${stack}`,
      "working-directory": workDir,
      env: {
        CDK_DEFAULT_REGION: region,
      },
    },
    // Emit deployment audit event (always runs, even if deploy failed/skipped).
    {
      name: "Emit deployment audit event",
      if: "always()",
      env: {
        ACTOR: "${{ github.actor }}",
        REPOSITORY: "${{ github.repository }}",
        WORKFLOW_RUN_ID: "${{ github.run_id }}",
        SHA: "${{ github.sha }}",
        ENVIRONMENT: envName,
        CDK_STACK: stack,
        AWS_REGION: region,
        DEPLOY_OUTCOME: "${{ steps.cdk-deploy.outcome }}",
        PR_URL: "${{ github.event.pull_request.html_url || '' }}",
        // Work ID extraction: head_ref is set on PR events; head_commit.message
        // is set on push events (merge to main). Both are checked so DORA
        // summaries show a Work ID regardless of which trigger fired.
        GITHUB_HEAD_REF: "${{ github.head_ref || '' }}",
        HEAD_COMMIT_MESSAGE: "${{ github.event.head_commit.message || '' }}",
      },
      run: emitAuditEventScript(envName),
    },
    {
      name: "Upload audit events",
      if: "always()",
      uses: "actions/upload-artifact@v4",
      with: {
        name: `audit-events-${envName}`,
        path: "dora-events.ndjson",
        "if-no-files-found": "ignore",
      },
    },
  ];

  const job: GithubJob = {
    name: `Deploy (${envName})`,
    "runs-on": runsOn,
    environment: envConfig.githubEnvironment,
    permissions: {
      contents: "read",
      "id-token": "write",
    },
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

function emitAuditEventScript(envName: string): string {
  const marker = `DEVEX_EMIT_AUDIT_${envName.toUpperCase()}`;
  return [
    `node --input-type=module << '${marker}'`,
    `import { appendFileSync, existsSync, mkdirSync } from "node:fs";`,
    `import { dirname, resolve } from "node:path";`,
    `const outcome = process.env.DEPLOY_OUTCOME ?? "unknown";`,
    `const doraEventType = outcome === "success" ? "deployment_succeeded" : "deployment_failed";`,
    `const headRef = process.env.GITHUB_HEAD_REF ?? "";`,
    `const commitMsg = process.env.HEAD_COMMIT_MESSAGE ?? "";`,
    `// For push-to-main events GitHub sets the merge commit message to:`,
    `//   "Merge pull request #N from org/feature/FIN-123-description"`,
    `// Parsing the source branch name is more reliable than scanning the raw`,
    `// commit body because the branch was governance-validated and cannot be`,
    `// overridden by an AI-generated PR description or commit message.`,
    `const mergeMatch = commitMsg.match(/Merge pull request #\\d+ from [^\\/]+\\/([^\\n]+)/);`,
    `const sourceBranch = mergeMatch ? mergeMatch[1].trim() : headRef;`,
    `const workIdMatch = sourceBranch.match(/[A-Z]+-[0-9]+/)`,
    `  ?? (!mergeMatch && !headRef ? commitMsg.match(/[A-Z]+-[0-9]+/) : null);`,
    `const workId = workIdMatch ? workIdMatch[0] : null;`,
    `const event = {`,
    `  schemaVersion: "1.0",`,
    `  timestamp: new Date().toISOString(),`,
    `  doraEventType,`,
    `  actor: process.env.ACTOR ?? "",`,
    `  repository: process.env.REPOSITORY ?? "",`,
    `  workflowRunId: process.env.WORKFLOW_RUN_ID ?? "",`,
    `  sha: process.env.SHA ?? "",`,
    `  workId,`,
    `  environment: process.env.ENVIRONMENT ?? "${envName}",`,
    `  cdkStack: process.env.CDK_STACK ?? "",`,
    `  awsRegion: process.env.AWS_REGION ?? "us-east-1",`,
    `  stage: "deploy-${envName}",`,
    `  result: outcome === "success" ? "success" : "failure",`,
    `  why: process.env.PR_URL ?? "",`,
    `};`,
    `const outputPath = resolve("dora-events.ndjson");`,
    `const dir = dirname(outputPath);`,
    `if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }`,
    `appendFileSync(outputPath, JSON.stringify(event) + "\\n", "utf-8");`,
    `console.log("✓ Audit event emitted:", doraEventType);`,
    `${marker}`,
  ].join("\n");
}
