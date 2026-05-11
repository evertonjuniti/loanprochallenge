# @loanpro/devex-cli

Developer-facing CLI for the LoanPro Golden Path. It connects a service repository to the central `@loanpro/devex-workflow-framework` by enforcing Git conventions, validating `devex.yaml`, generating and installing Git hooks, and providing one-command shortcuts for daily workflow tasks.

---

## What it does

| Command | Purpose |
|---|---|
| `devex init` | Bootstrap a new service repo — generates `devex.yaml`, GitHub workflow caller, PR template, Amazon Q rules, Kiro steering files, and Git hooks |
| `devex check` | 7-point compliance check: config validity, branch name, commit messages, workflow ref pin, hooks presence, PR template, required files |
| `devex branch WORK-ID [description]` | Create a correctly-named branch: `feature/FIN-123-add-payment-validation` |
| `devex pr --title "..."` | Open a PR via the GitHub CLI with the Work ID auto-prepended to the title |
| `devex validate` | Run `devex check`, lint, unit tests, property tests, and contract tests in sequence |
| `devex hooks install` | Render and install `commit-msg` and `pre-push` Git hooks into `.git/hooks/` (local only) |
| `devex hooks install --shared` | Same but writes to `.githooks/` and sets `git core.hooksPath` — hooks can be committed and shared across the team |
| `devex upgrade --workflow-version v0.3.1` | Update the pinned workflow ref across `devex.yaml` and `.github/workflows/devex-pr.yml` |

---

## Requirements

- Python ≥ 3.11
- [uv](https://docs.astral.sh/uv/) (recommended) or pip
- Git
- GitHub CLI (`gh`) — required only for `devex pr`

---

## Installation

### Into a service repository (recommended)

```bash
pip install "devex-cli @ git+https://github.com/evertonjuniti/loanprochallenge#subdirectory=packages/cli"
```

Or with uv:

```bash
uv tool install "devex-cli @ git+https://github.com/evertonjuniti/loanprochallenge#subdirectory=packages/cli"
```

### From the monorepo (editable, for development)

```bash
cd packages/cli
pip install -e ".[dev]"
```

---

## Usage

### Bootstrap a new service repository

Run inside the target repo (must already have `git init` or be cloned):

```bash
devex init
```

The command prompts for service name, team owner, application language, infra framework, and workflow ref, then generates:

```
<repo-root>/
├── devex.yaml
├── .github/
│   ├── workflows/devex-pr.yml
│   └── pull_request_template.md
├── .amazonq/rules/
│   ├── dora-and-audit.md
│   └── golden-path.md
├── .kiro/steering/
│   ├── product.md
│   └── tech.md
└── .git/hooks/
    ├── commit-msg
    └── pre-push
```

Flags:

```
--service / -s       Service name (e.g. transactionify)
--owner / -o         Team name (e.g. payments-platform)
--app-language / -l  Runtime language: python | go | typescript | clojure | java | rust
--infra / -i         Infra framework: aws-cdk-typescript | terraform | pulumi | none
--workflow-ref       Workflow framework version tag (e.g. v0.3.1)
--force / -f         Overwrite existing files
--skip-check         Skip the final devex check step
```

### Check compliance

```bash
devex check
```

Prints a table showing which of the 7 Golden Path checks pass or fail, and exits non-zero on any failure.

### Create a branch

```bash
devex branch FIN-123 "add payment validation"
# → git checkout -b feature/FIN-123-add-payment-validation

devex branch FIN-123 --type hotfix
# → git checkout -b hotfix/FIN-123

devex branch FIN-123 "fix fee calc" --dry-run
# → prints branch name without running git
```

### Open a pull request

```bash
devex pr --title "Add payment validation"
# → gh pr create --title "[FIN-123] Add payment validation" --base main
```

The Work ID is read automatically from the current branch name. The body defaults to `.github/pull_request_template.md` when present.

Additional flags: `--draft`, `--base <branch>`, `--body-file <path>`, `--dry-run`.

### Run all local checks

```bash
devex validate
```

Runs in order: `devex check` → lint → unit tests → property tests → contract tests. Commands are read from the `local.*` fields in `devex.yaml`. Individual steps can be skipped with `--skip-check`, `--skip-lint`, or `--skip-tests`.

### Install or refresh Git hooks

```bash
devex hooks install                  # install into .git/hooks/ (local only)
devex hooks install --force          # overwrite existing hooks
devex hooks install --shared         # write to .githooks/ + set core.hooksPath
devex hooks install --shared --force # regenerate shared hooks after devex.yaml changes
```

Use `--shared` when you want hooks committed to the repository so every team member gets them automatically. After cloning a repo with `.githooks/`, team members only need to run `devex hooks install --shared` once to activate them.

### Upgrade the workflow framework version

```bash
devex upgrade --workflow-version v0.3.1
devex upgrade --workflow-version v0.3.1 --dry-run  # preview changes only
```

Updates every occurrence of the old ref in `devex.yaml` and `.github/workflows/devex-pr.yml`.

---

## `devex.yaml` reference

Every service repository must have a `devex.yaml` at its root. `devex check` and most commands read it automatically by walking up the directory tree.

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/evertonjuniti/loanprochallenge/main/packages/workflow-framework/devex.schema.json
schemaVersion: 1

service:
  name: my-service
  owner: my-team

runtime:
  appLanguage: python            # single language, or array for polyglot: [typescript, python]
  infraLanguage: typescript
  infraFramework: aws-cdk-typescript

local:
  testCommand: "uv run pytest"
  lintCommand: "uv run ruff check ."
  contractTestCommand: "uv run pytest tests/contracts"
  propertyTestCommand: "uv run pytest tests/property"

environments:
  production:
    cdkStack: MyServiceProduction
    githubEnvironment: production

workflowVersion:
  ref: v0.3.1                    # must be a semver tag or full 40-char SHA
```

Full reference: [devex.schema.json](../workflow-framework/devex.schema.json).

---

## Contributing

### Set up the development environment

```bash
cd packages/cli
pip install -e ".[dev]"
```

### Run tests

```bash
pytest
```

All 100 tests must pass before opening a PR.

### Project layout

```
packages/cli/
├── pyproject.toml
└── src/devex_cli/
    ├── main.py               ← root Typer app; registers all commands
    ├── commands/
    │   ├── branch.py         ← devex branch
    │   ├── check.py          ← devex check
    │   ├── hooks.py          ← devex hooks install
    │   ├── init.py           ← devex init
    │   ├── pr.py             ← devex pr
    │   ├── upgrade.py        ← devex upgrade
    │   └── validate.py       ← devex validate
    ├── adapters/
    │   └── language_defaults.py  ← per-language CI command registry
    ├── config/
    │   ├── loader.py         ← YAML loader with auto-discovery
    │   └── schema.py         ← Pydantic v2 models (mirrors devex.schema.json)
    ├── governance/
    │   └── work_id.py        ← branch/commit/PR-title validators
    └── templates/            ← Jinja2 templates rendered by devex init/hooks
```

### Adding a new language

1. Add an entry to `src/devex_cli/adapters/language_defaults.py` with the language's default commands.
2. Register the language in the TypeScript adapter registry at `packages/workflow-framework/src/adapters/index.ts`.
3. Add tests to `tests/`.
4. Open a PR following the Work ID branch convention: `feature/DEVEX-<n>-<description>`.

### Contribution guidelines

See [docs/contribution-guidelines.md](../../docs/contribution-guidelines.md) for the full inner-source process, including branch naming rules, PR title format, and the release process.
