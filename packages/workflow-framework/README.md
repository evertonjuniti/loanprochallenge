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
pnpm add -D github:evertonjuniti/loanprochallenge#v0.1.0
```

To update to a newer release:

```bash
pnpm add -D github:evertonjuniti/loanprochallenge#v0.2.0
```

### Option B — GitHub Packages registry (for production purposes)

For teams using a private npm registry:

```bash
# .npmrc or .pnpmrc in the service repo
@loanpro:registry=https://npm.pkg.github.com

pnpm add -D @loanpro/devex-workflow-framework@0.1.0
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

### Generate a typed PR pipeline workflow for a service

`createPrWorkflow(config)` accepts a validated `DevexConfig` and returns a
complete `GithubWorkflow` object. `renderWorkflowYaml(workflow)` serialises
it to a GitHub Actions YAML string.

```typescript
import { loadConfig, createPrWorkflow, renderWorkflowYaml } from "@loanpro/devex-workflow-framework";
import { writeFileSync, mkdirSync } from "node:fs";

const config = await loadConfig("devex.yaml");  // validates against Zod schema
const workflow = createPrWorkflow(config);
const yaml = renderWorkflowYaml(workflow);

mkdirSync(".github/workflows", { recursive: true });
writeFileSync(".github/workflows/pr.yml", yaml);
```

The generated workflow contains these jobs, wired in dependency order:

| Job | Depends on | Purpose |
|---|---|---|
| `governance` | — | Branch name, PR title, commit messages, workflow ref |
| `small-tests` | governance | Unit, property, contract tests + lint (via language adapter) |
| `cdk-synth` | small-tests | CDK `cdk synth` (omitted when `infraFramework ≠ aws-cdk-typescript`) |
| `deploy-<env>` | previous env | Sequential CDK deploy + OIDC credentials per environment |
| `dora-audit` | last deploy job | Compute DORA metrics, write step summary, upload artifact |

Regenerate `.github/workflows/pr.yml` from this repo:

```bash
node scripts/generate-workflows.mjs
```

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
pnpm add -D github:evertonjuniti/loanprochallenge#v0.2.0
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
