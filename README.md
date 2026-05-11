# LoanPro DevEx Golden Path

A monorepo that implements the **Golden Path** — a set of opinionated, reusable platform components that every LoanPro engineering team can adopt to get CI/CD governance, DORA telemetry, and AWS infrastructure right from day one, without reinventing them per service.

---

## What problem does this solve?

Service teams spend significant time on undifferentiated work: wiring up GitHub Actions pipelines, deciding on branch naming conventions, configuring AWS Lambda stacks, and collecting deployment metrics. The Golden Path encodes those decisions once, centrally, and exposes them as versioned, adoptable components. Teams get a working pipeline on their first push.

---

## Repository layout

```
loanprochallenge/
├── packages/
│   ├── workflow-framework/   ← Component B — TypeScript library (npm package)
│   └── cli/                  ← Component A — Python CLI (pip package)
├── .githooks/                ← committed Git hooks (activated by install-hooks.mjs)
│   └── pre-push              ← runs workflow-framework + CLI checks before every push
├── docs/
│   └── contribution-guidelines.md
└── scripts/
    ├── generate-workflows.mjs   ← regenerate .github/workflows/ from devex.yaml
    ├── install-hooks.mjs        ← one-time hook activation per clone
    ├── setup-repo.mjs           ← apply GitHub branch protection rules
    └── check-governance.mjs     ← validate branch, commits, and PR title in CI
```

---

## Components

### Component B — `@loanpro/devex-workflow-framework` (TypeScript)

**Location:** `packages/workflow-framework/`  
**Package:** `@loanpro/devex-workflow-framework` v0.3.2

A shared TypeScript/Node.js library that is the authoritative source for all Golden Path rules. Service repositories install it as a versioned dependency and use it to generate their GitHub Actions workflow files. It is never run directly in production — it runs during CI.

| Module | What it provides |
|---|---|
| `config/` | Zod schema for `devex.yaml`, YAML loader, and validator |
| `governance/` | Work ID validation, branch/commit/PR-title rules |
| `telemetry/` | DORA event types, audit event schema, metric aggregation, Markdown summaries |
| `adapters/` | `LanguageAdapter` interface + `PythonAdapter`, `TypescriptAdapter` |
| `github/` | Typed GitHub Actions workflow generator: `createCiWorkflow`, `createPrWorkflow`, `createMainWorkflow`, `createSyncWorkflow` |
| `cdk/` | `GoldenLambdaApi` CDK construct (Lambda + API GW + alarms + standard tags) |

The package also installs a `devex-workflow` binary for use in service repos:

```bash
pnpm exec devex-workflow generate     # regenerate all .github/workflows/*.yml
pnpm exec devex-workflow setup-repo   # apply GitHub branch protection rules
```

→ Full docs: [`packages/workflow-framework/README.md`](packages/workflow-framework/README.md)

---

### Component A — `devex-cli` (Python)

**Location:** `packages/cli/`  
**Package:** `devex-cli` v0.1.0

A Python CLI that developers run locally inside their service repositories. It is the human-facing layer of the Golden Path — it enforces conventions at the point where mistakes are cheapest to fix (before a push), and it does the initial setup work so teams can onboard in minutes.

| Command | What it does |
|---|---|
| `devex init` | Bootstrap a service repo: generates `devex.yaml`, GitHub workflow caller, PR template, Amazon Q rules, Kiro steering files, and Git hooks |
| `devex check` | 7-point compliance check: config validity, branch name, commit messages, workflow ref pin, hooks, PR template, required files |
| `devex branch FIN-123 "description"` | Create a compliant branch: `feature/FIN-123-description` |
| `devex pr --title "..."` | Open a PR via the GitHub CLI with the Work ID prepended to the title |
| `devex validate` | Run `devex check`, lint, and all test commands from `devex.yaml` |
| `devex hooks install` | Render and install `commit-msg` and `pre-push` Git hooks into `.git/hooks/` |
| `devex hooks install --shared` | Same as above but writes to `.githooks/` and sets `core.hooksPath` — hooks are committed to the repo and shared across the team |
| `devex upgrade --workflow-version v0.3.2` | Update the pinned framework ref across `devex.yaml` and the caller workflow |

→ Full docs: [`packages/cli/README.md`](packages/cli/README.md)

---

## How the pieces fit together

```
┌─────────────────────────────────────────────────────────────────┐
│  Service repository  (e.g. transactionify)                      │
│                                                                 │
│  devex.yaml  ←─── written by devex init, read by everything     │
│  .git/hooks/ ←─── commit-msg, pre-push (enforced locally)       │
│  .github/workflows/devex-pr.yml  ←─── thin caller workflow      │
│                    │                                            │
└────────────────────┼────────────────────────────────────────────┘
                     │ uses: loanprochallenge/.github/workflows/pr.yml@v0.3.2
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  packages/workflow-framework  (this repo, versioned)            │
│                                                                 │
│  governance job  →  small-tests job  →  cdk-synth job           │
│                                          │  (PR workflow)       │
│                                      deploy jobs                │
│                                          │  (Main workflow)     │
│                                      dora-audit job             │
└─────────────────────────────────────────────────────────────────┘
```

**Developer flow:**

1. Run `devex init` inside a service repo → config and hooks are created.
2. Run `devex branch FIN-123 "my change"` → branch is created with the correct name.
3. Commit with `[FIN-123] message format` → `commit-msg` hook enforces this.
4. Push → `pre-push` hook runs `devex check`.
5. Open a PR → `devex pr --title "My change"` prepends `[FIN-123]` automatically.
6. GitHub Actions runs the generated workflow → governance, tests, and CDK synth gate the merge.
7. On merge to `main` → full deploy pipeline runs with DORA telemetry captured.

---

## `devex.yaml` — the integration contract

Every service repository must have a `devex.yaml` at its root. It is the single source of truth shared between the CLI, the workflow framework, and the generated GitHub Actions workflows.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/evertonjuniti/loanprochallenge/main/packages/workflow-framework/devex.schema.json
schemaVersion: 1

service:
  name: transactionify
  owner: payments-platform

runtime:
  appLanguage: python              # single language, or array for polyglot: [typescript, python]
  infraLanguage: typescript
  infraFramework: aws-cdk-typescript

local:
  testCommand: "uv run pytest"
  lintCommand: "uv run ruff check ."

environments:
  production:
    cdkStack: TransactionifyProduction
    githubEnvironment: production

workflowVersion:
  ref: v0.3.2                      # must be a semver tag or 40-char SHA
```

Full schema reference: [`packages/workflow-framework/devex.schema.json`](packages/workflow-framework/devex.schema.json)

---

## Generated GitHub Actions workflows

Running `pnpm exec devex-workflow generate` (or `devex init`) produces four workflow files in the service repo:

| File | Trigger | Jobs |
|---|---|---|
| `ci.yml` | push to non-main branches | governance → small-tests |
| `pr.yml` | pull_request | governance → small-tests → cdk-synth |
| `main.yml` | push to main | governance → small-tests → cdk-synth → deploy-* → dora-audit |
| `devex-sync.yml` | workflow_dispatch | Bumps framework version and opens a PR |

---

## CDK construct — `GoldenLambdaApi`

For Python Lambda services using AWS CDK, `GoldenLambdaApi` provisions the full standard stack in one construct:

- Python `lambda.Function` (configurable memory, concurrency, runtime)
- `apigw.RestApi` backed by the Lambda
- `logs.LogGroup` with configurable retention
- `cloudwatch.Alarm` for error rate and P99 duration
- Standard `devex:*` tags on every resource

```typescript
import { GoldenLambdaApi } from "@loanpro/devex-workflow-framework";

const api = new GoldenLambdaApi(this, "TransactionifyApi", {
  serviceName: "transactionify",
  handlerPath: path.join(__dirname, "../src"),
  environmentName: "production",
});
```

---

## Local development (inside this monorepo)

### Prerequisites

- Node.js ≥ 24
- pnpm
- Python ≥ 3.11

### Setup

```bash
git clone https://github.com/evertonjuniti/loanprochallenge.git
cd loanprochallenge

# Activate the committed Git hooks (one-time per clone)
node scripts/install-hooks.mjs

# Install Node.js dependencies for the workflow-framework package
cd packages/workflow-framework
pnpm install

# Install Python dependencies for the CLI package
cd ../cli
pip install -e ".[dev]"
```

### Run tests

```bash
# TypeScript — workflow-framework
cd packages/workflow-framework
pnpm test          # 227 tests
pnpm typecheck

# Python — CLI
cd packages/cli
pytest             # 100 tests
```

### Regenerate this repo's own workflow files

The monorepo's own `.github/workflows/` are generated from the framework:

```bash
cd packages/workflow-framework
pnpm build
cd ../..
node scripts/generate-workflows.mjs
```

### Apply branch protection to this repo

```bash
node scripts/setup-repo.mjs
```

Requires the `gh` CLI to be installed and authenticated.

---

## Contributing

See [`docs/contribution-guidelines.md`](docs/contribution-guidelines.md) for the full inner-source process.

Quick reference:

| Step | Action |
|---|---|
| 1 | Open an issue or work item; get a `DEVEX-<n>` ID |
| 2 | Clone and run `node scripts/install-hooks.mjs` (one-time) |
| 3 | Branch: `feature/DEVEX-<n>-<description>` |
| 4 | Commits: `[DEVEX-<n>] Short description` |
| 5 | Run `pnpm test` (TypeScript) and `pytest` (Python) — both must pass |
| 6 | PR title: `[DEVEX-<n>] Short description` |
| 7 | Two approving reviews required before merge |

**What you can contribute:**

- New language adapter (e.g. Rust, Java) → `packages/workflow-framework/src/adapters/`
- New telemetry sink → `packages/workflow-framework/src/telemetry/`
- New governance rule → `packages/workflow-framework/src/governance/`
- New CDK construct → `packages/workflow-framework/src/cdk/`
- CLI command or template → `packages/cli/src/`
- Documentation → `docs/` or package `README.md`
