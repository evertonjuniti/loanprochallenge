# @loanpro/devex-workflow-framework

A shared TypeScript library that acts as the **Golden Path** for LoanPro engineering teams — providing the typed configuration contract, CI/CD governance rules, DORA telemetry primitives, and AWS CDK constructs that every service team can rely on instead of reinventing them.

Source repository: https://github.com/evertonjuniti/loanprochallenge

---

## What is in this package

| Module | Purpose |
|---|---|
| `config/` | Zod schema for `devex.yaml`, YAML config loader, and validator |
| `governance/` | Work ID validation, branch/commit/PR-title rules, branch name builder |
| `telemetry/` | Base event types, audit event schema, DORA event schema and metric aggregation |
| `adapters/` | `LanguageAdapter` interface, `PythonAdapter`, `TypescriptAdapter`, adapter registry |
| `github/` | Typed GitHub Actions workflow generator: job builders + `createPrWorkflow()` |
| `cdk/` | CDK constructs: `GoldenLambdaApi` (Lambda + API GW + alarms + tags), `applyGoldenPathTags()` |

Everything is exported from the single entry point `src/index.ts`.

---

## Requirements

- Node.js ≥ 24
- pnpm (recommended) or npm

---

## Installation

### Option A — Git dependency (recommended for this PoC / challenge)

Pin the package directly to a release tag. No private registry is required.

```bash
pnpm add -D github:evertonjuniti/loanprochallenge#v0.3.0
```

To update to a newer release:

```bash
pnpm add -D github:evertonjuniti/loanprochallenge#v0.4.0
```

### Option B — GitHub Packages registry (for production purposes)

For teams using a private npm registry:

```bash
# .npmrc or .pnpmrc in the service repo
@loanpro:registry=https://npm.pkg.github.com

pnpm add -D @loanpro/devex-workflow-framework@0.3.0
```

### Option C — pnpm workspace (within this monorepo)

If you are working inside `evertonjuniti/loanprochallenge` itself:

```bash
pnpm add -D @loanpro/devex-workflow-framework --workspace
```

---

## Configuration

Each service repository must have a `devex.yaml` at its root. The file is validated against `devex.schema.json`.

Minimal example:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/evertonjuniti/loanprochallenge/main/packages/workflow-framework/devex.schema.json
schemaVersion: 1

service:
  name: my-service
  owner: my-team

runtime:
  appLanguage: python

environments:
  production:
    cdkStack: MyServiceProduction
    githubEnvironment: production
```

Full example with all optional fields: see [devex.yaml](./devex.yaml).

---

## Usage examples

### Validate a `devex.yaml` at runtime

```typescript
import { assertValidConfig } from "@loanpro/devex-workflow-framework";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const raw = parse(readFileSync("devex.yaml", "utf-8"));
const config = assertValidConfig(raw); // throws with field-level messages if invalid
console.log(config.service.name);
```

### Validate a branch name in a governance script

```typescript
import { validateBranchName } from "@loanpro/devex-workflow-framework";

const result = validateBranchName(process.env.GITHUB_HEAD_REF ?? "");

if (!result.valid) {
  console.error(result.message);
  process.exit(1);
}

console.log(`Work ID: ${result.workId}`);
```

### Validate all commit messages in a PR

```typescript
import { validateCommitMessages } from "@loanpro/devex-workflow-framework";

const messages = [
  "[FIN-123] Add payment validation",
  "forgot the work id",
];

const summary = validateCommitMessages(messages);

if (summary.violations.length > 0) {
  console.error("Commits missing Work ID:");
  summary.violations.forEach(v => console.error(`  • ${v}`));
  process.exit(1);
}
```

### Enforce a pinned workflow ref

```typescript
import { validateWorkflowRef } from "@loanpro/devex-workflow-framework";

const result = validateWorkflowRef("main"); // rejected
// result.valid === false
// result.errors[0].message → 'Ref "main" is not a pinned semver tag ...'
```

### Emit a deployment audit event and write it to a GitHub Actions artifact

```typescript
import {
  createDeploymentAuditEvent,
  appendEventsToFile,
} from "@loanpro/devex-workflow-framework";

const event = createDeploymentAuditEvent({
  eventType: "deployment_succeeded",
  actor: "octocat",
  repository: "evertonjuniti/transactionify",
  workflowRunId: "123456",
  sha: "abc123",
  workId: "FIN-123",
  environment: "production",
  cdkStack: "TransactionifyProduction",
  awsRegion: "us-east-1",
  stage: "deploy-production",
  result: "success",
  why: "https://github.com/evertonjuniti/transactionify/pull/42",
});

// Appends to dora-events.ndjson — safe to call multiple times across steps
appendEventsToFile([event]);
```

Then upload the file as a GitHub Actions artifact:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: dora-events
    path: dora-events.ndjson
```

### Resolve a language adapter and generate workflow steps

```typescript
import { resolveAdapter } from "@loanpro/devex-workflow-framework";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const config = assertValidConfig(parse(readFileSync("devex.yaml", "utf-8")));
const adapter = resolveAdapter(config); // PythonAdapter, TypescriptAdapter, etc.

const steps = [
  ...adapter.setupSteps(config),
  ...adapter.unitTestSteps(config),
  ...adapter.lintSteps(config),
];
// steps is WorkflowStep[] — ready to be serialised into a GitHub Actions workflow
```

### Compute DORA metrics from a set of events

```typescript
import { computeDoraMetrics, renderDoraSummaryMarkdown } from "@loanpro/devex-workflow-framework";

const summary = computeDoraMetrics(events);
console.log(renderDoraSummaryMarkdown(summary, "FIN-123", "production"));
```

### Generate GitHub Actions workflow files

The package ships four workflow generators. Each returns a `GithubWorkflow`
object that `renderWorkflowYaml()` serialises to a GitHub Actions YAML string.

| Generator | Output file | Trigger | Purpose |
|---|---|---|---|
| `createCiWorkflow(config)` | `ci.yml` | push to non-main branches | Fast governance + unit/lint feedback during active development |
| `createPrWorkflow(config)` | `pr.yml` | pull_request | Quality gate before merge: governance → tests → CDK synth |
| `createMainWorkflow(config)` | `main.yml` | push to main | Full pipeline after merge: governance → tests → CDK synth → deploy → DORA audit |
| `createSyncWorkflow(config)` | `devex-sync.yml` | workflow_dispatch | Bumps the framework version and regenerates all workflow files via PR |

#### Recommended: use the `devex-workflow generate` command (see next section)

Or call the generators directly in your own script:

```typescript
import {
  loadConfig,
  createCiWorkflow,
  createPrWorkflow,
  createMainWorkflow,
  createSyncWorkflow,
  renderWorkflowYaml,
} from "@loanpro/devex-workflow-framework";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const config = loadConfig("devex.yaml");  // synchronous; throws ZodError if invalid

mkdirSync(".github/workflows", { recursive: true });

const workflows = [
  { name: "ci.yml",         workflow: createCiWorkflow(config)   },
  { name: "pr.yml",         workflow: createPrWorkflow(config)   },
  { name: "main.yml",       workflow: createMainWorkflow(config) },
  { name: "devex-sync.yml", workflow: createSyncWorkflow(config) },
];

for (const { name, workflow } of workflows) {
  writeFileSync(join(".github/workflows", name), renderWorkflowYaml(workflow));
}
```

#### `createPrWorkflow` job graph

| Job | Depends on | Purpose |
|---|---|---|
| `governance` | — | Branch name, PR title, commit messages, workflow ref |
| `small-tests` | governance | Unit, property, contract tests + lint (via language adapter) |
| `cdk-synth` | small-tests | CDK `cdk synth` (omitted when `infraFramework ≠ aws-cdk-typescript`) |

#### `createMainWorkflow` job graph

| Job | Depends on | Purpose |
|---|---|---|
| `governance` | — | Branch name, PR title, commit messages, workflow ref |
| `small-tests` | governance | Unit, property, contract tests + lint |
| `cdk-synth` | small-tests | CDK `cdk synth` (omitted when no CDK) |
| `deploy-<env>` | previous env | Sequential CDK deploy + OIDC credentials per environment |
| `dora-audit` | last deploy job | Compute DORA metrics, write step summary, upload artifact |

---

### `devex-workflow` CLI (installed with the package)

When you install `@loanpro/devex-workflow-framework`, a `devex-workflow` binary
is added to your local `node_modules/.bin/`. It is the primary way consuming
repos keep their workflow files up to date.

#### `devex-workflow generate`

Reads `devex.yaml` and (re)generates all four workflow files under `.github/workflows/`:

```bash
pnpm exec devex-workflow generate

# Custom paths:
pnpm exec devex-workflow generate --config path/to/devex.yaml --output-dir .github/workflows
```

Output:

```
✓ Loaded config for service: transactionify
  runtime:  python / aws-cdk-typescript
✓ Generated: .github/workflows/ci.yml
  Jobs: governance, small-tests
✓ Generated: .github/workflows/pr.yml
  Jobs: governance, small-tests, cdk-synth
✓ Generated: .github/workflows/main.yml
  Jobs: governance, small-tests, cdk-synth, deploy-sandbox, deploy-staging, deploy-production, dora-audit
✓ Generated: .github/workflows/devex-sync.yml
  Jobs: sync
```

Run this after every change to `devex.yaml` and commit the regenerated files.

#### `devex-workflow setup-repo`

Applies GitHub branch protection rules to the `main` branch so that all PR
workflow jobs must pass before a PR can be merged. Requires the `gh` CLI to be
installed and authenticated.

```bash
pnpm exec devex-workflow setup-repo

# Custom branch:
pnpm exec devex-workflow setup-repo --branch main --config devex.yaml
```

The command derives the required check context names from the generated PR
workflow and calls `gh api repos/{owner}/{repo}/branches/{branch}/protection`.

You can also derive the required checks programmatically:

```typescript
import { loadConfig, createPrWorkflow, buildBranchProtectionConfig } from "@loanpro/devex-workflow-framework";

const config = loadConfig("devex.yaml");
const prWorkflow = createPrWorkflow(config);
const protection = buildBranchProtectionConfig(prWorkflow, { strict: true });
// protection is ready to POST to the GitHub branch protection API
```

### Deploy a service with GoldenLambdaApi (CDK construct)

`GoldenLambdaApi` provisions the full Transactionify-style AWS stack — Python
Lambda, API Gateway REST API, CloudWatch log group, error-rate alarm, and p99
duration alarm — with standard Golden Path tags applied to every resource.

#### Install peer dependencies first

`aws-cdk-lib` and `constructs` are **optional** peer dependencies. Install them
only in CDK app repos (not in service repos that only need the workflow generator):

```bash
# npm
npm install --save-dev aws-cdk-lib constructs

# pnpm
pnpm add -D aws-cdk-lib constructs
```

#### Example CDK stack

```typescript
import * as path from "node:path";
import { Stack, StackProps, App } from "aws-cdk-lib";
import { Construct } from "constructs";
import { GoldenLambdaApi } from "@loanpro/devex-workflow-framework";

export class TransactionifySandboxStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const api = new GoldenLambdaApi(this, "TransactionifyApi", {
      // Matches devex.yaml service.name
      serviceName: "transactionify",

      // Path to the Python handler source directory (bundled by CDK)
      handlerPath: path.join(__dirname, "../src"),

      // Must match one of the devex.yaml environments keys
      environmentName: "sandbox",

      // Optional: adds a devex:work-prefix tag to every resource
      workTrackingTag: "FIN",

      // Additional Lambda environment variables (TABLE_NAME, etc.)
      environment: {
        TABLE_NAME: "my-table",
      },

      // Tune defaults if needed:
      // memorySize: 512,
      // reservedConcurrency: 50,
      // errorRateThresholdPercent: 5,
      // p99DurationThresholdMs: 1000,
    });

    // Exposed CDK resources for further customisation:
    // api.lambdaFunction  — lambda.Function
    // api.restApi         — apigw.RestApi
    // api.logGroup        — logs.LogGroup
    // api.errorRateAlarm  — cloudwatch.Alarm
    // api.p99DurationAlarm — cloudwatch.Alarm
  }
}

const app = new App();
new TransactionifySandboxStack(app, "TransactionifySandbox");
```

#### Resources created

| AWS Resource | ID pattern |
|---|---|
| `AWS::Lambda::Function` | `<serviceName>-<environmentName>` |
| `AWS::ApiGateway::RestApi` | `<serviceName>-<environmentName>` |
| `AWS::Logs::LogGroup` | `/aws/lambda/<serviceName>-<environmentName>` |
| `AWS::CloudWatch::Alarm` | `<serviceName>-<environmentName>-error-rate` |
| `AWS::CloudWatch::Alarm` | `<serviceName>-<environmentName>-p99-duration` |

#### Standard tags applied to all resources

| Tag | Value |
|---|---|
| `devex:service` | `serviceName` from props |
| `devex:environment` | `environmentName` from props |
| `devex:managed-by` | `devex-workflow-framework` (always) |
| `devex:work-prefix` | `workTrackingTag` from props (omitted when not provided) |

---

## Local development

```bash
git clone https://github.com/evertonjuniti/loanprochallenge.git
cd loanprochallenge/packages/workflow-framework

pnpm install
pnpm test          # run unit tests
pnpm test:watch    # watch mode
pnpm build         # compile to dist/
pnpm typecheck     # type-check without emitting
```

---

## Versioning and releases

This package follows [Semantic Versioning](https://semver.org):

| Change type | Version bump |
|---|---|
| Bug fix, no API change | `0.1.0 → 0.1.1` (patch) |
| New feature, backward compatible | `0.1.0 → 0.2.0` (minor) |
| Breaking API or schema change | `0.1.0 → 1.0.0` (major) |

To cut a release (see [contribution guidelines](../../docs/contribution-guidelines.md#release-process-platform-team) for the full process):

```bash
cd packages/workflow-framework

# 1. Create a release branch
git checkout -b chore/DEVEX-<n>-release-v<new-version>

# 2. Bump version only (no commit, no tag)
npm version minor --no-git-tag-version

# 3. Commit and open a PR
git add package.json
git commit -m "[DEVEX-<n>] Release v<new-version>"
git push origin chore/DEVEX-<n>-release-v<new-version>

# 4. After PR merges, tag the merge commit
git checkout main && git pull
git tag v<new-version>
git push origin v<new-version>
```

Service repos update by changing their pinned ref:

```bash
pnpm add -D github:evertonjuniti/loanprochallenge#v0.4.0
```

---

## Contributing

See the full inner-source contribution guide at [docs/contribution-guidelines.md](../../docs/contribution-guidelines.md).

Quick summary:

1. Open an issue describing the change or new language adapter you want to add.
2. Fork or branch from `main` using the Work ID convention: `feature/DEVEX-<n>-<description>`.
3. Make your changes inside `packages/workflow-framework/src/`.
4. Add or update tests in `packages/workflow-framework/test/`.
5. Run `pnpm test` and `pnpm typecheck` — both must pass.
6. Open a PR with the title `[DEVEX-<n>] <description>` and fill in the PR template.
7. The PR requires two approving reviews before merge.
