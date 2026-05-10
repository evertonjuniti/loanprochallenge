# @loanpro/devex-workflow-framework

A shared TypeScript library that acts as the **Golden Path** for LoanPro engineering teams — providing the typed configuration contract, CI/CD governance rules, DORA telemetry primitives, and AWS CDK constructs that every service team can rely on instead of reinventing them.

Source repository: https://github.com/evertonjuniti/loanprochallenge

---

## What is in this package

| Module | Purpose |
|---|---|
| `config/` | Zod schema for `devex.yaml`, config loader, and validator |
| `governance/` | Work ID validation, branch/commit/PR-title rules, branch name builder |
| `telemetry/` | Base event types, audit event schema, DORA event schema and metric aggregation |

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

### Emit and serialise a deployment audit event

```typescript
import { createDeploymentAuditEvent, toNdjson } from "@loanpro/devex-workflow-framework";

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

// Write to GitHub Actions artifact
import { appendFileSync } from "node:fs";
appendFileSync("dora-events.ndjson", toNdjson([event]));
```

### Compute DORA metrics from a set of events

```typescript
import { computeDoraMetrics, renderDoraSummaryMarkdown } from "@loanpro/devex-workflow-framework";

const summary = computeDoraMetrics(events);
console.log(renderDoraSummaryMarkdown(summary, "FIN-123", "production"));
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

To cut a release:

```bash
cd packages/workflow-framework
npm version minor          # bumps package.json and creates a git tag
git push origin v0.2.0     # tag is the release artifact for Git dependencies
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
