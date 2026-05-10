# Inner-Source Contribution Guidelines

This document defines how any LoanPro engineering team can propose changes, fix bugs, or add new language support to the **DevEx Golden Path ecosystem** hosted at https://github.com/evertonjuniti/loanprochallenge.

---

## Guiding principle

> The Golden Path must be easy to adopt and safe to extend. All contributions must preserve the stability of existing service integrations.

Teams are encouraged to contribute new language adapters, new telemetry sinks, and improvements to governance rules. The platform team reviews and merges contributions, but does not need to be the sole author.

---

## What you can contribute

| Contribution type | Where it goes |
|---|---|
| New language adapter (e.g. Rust, Java) | `packages/workflow-framework/src/adapters/` |
| New telemetry sink | `packages/workflow-framework/src/telemetry/` |
| New governance rule | `packages/workflow-framework/src/governance/` |
| New CDK construct | `packages/workflow-framework/src/cdk/` |
| Bug fix or schema change | Relevant module under `src/` |
| CLI command or template | `packages/cli/src/` |
| Documentation | `docs/` or package `README.md` |

---

## Work ID requirement

Every contribution must be linked to a tracked work item. Use the `DEVEX` project prefix.

Examples:
- `DEVEX-12` — add Rust language adapter
- `DEVEX-34` — fix commit message regex for merge commits

If you do not have access to the issue tracker, open a GitHub Issue first and use the issue number as the Work ID (e.g. `GH-42`).

---

## Branch naming

```
feature/DEVEX-<n>-<short-description>
fix/DEVEX-<n>-<short-description>
chore/DEVEX-<n>-<short-description>
```

Examples:
```
feature/DEVEX-12-add-rust-adapter
fix/DEVEX-34-commit-regex-merge-commits
```

Branches that do not match this pattern will be rejected by the governance check.

---

## Commit messages

Every commit on your branch must include the Work ID:

```
[DEVEX-12] Add Rust language adapter skeleton
[DEVEX-12] Add unit tests for Rust adapter
```

---

## Step-by-step workflow

### 1. Open an issue or work item

Before writing code, open an issue or create a work item describing:
- What you want to change and why.
- Which teams or services would benefit.
- Any breaking changes or schema changes involved.

### 2. Fork or create a branch

```bash
git clone https://github.com/evertonjuniti/loanprochallenge.git
cd loanprochallenge

# Create your branch with the Work ID
git checkout -b feature/DEVEX-12-add-rust-adapter
```

### 3. Make your changes

- Work inside `packages/workflow-framework/src/` (or `packages/cli/src/` for CLI contributions).
- Follow the existing module structure.
- Export new public symbols from `src/index.ts`.
- Do not break existing exports — add new ones instead.

#### Adding a new language adapter

Create a file at `src/adapters/<language>-adapter.ts` implementing the `LanguageAdapter` interface (to be defined in Phase 2). The interface will look like:

```typescript
export interface LanguageAdapter {
  name: string;
  setupSteps(config: DevexConfig): WorkflowStep[];
  unitTestSteps(config: DevexConfig): WorkflowStep[];
  propertyTestSteps(config: DevexConfig): WorkflowStep[];
  contractTestSteps(config: DevexConfig): WorkflowStep[];
}
```

Register the adapter in the adapter registry so it is resolved by `runtime.appLanguage` in `devex.yaml`.

### 4. Write tests

Every change must include tests in `packages/workflow-framework/test/`.

```bash
cd packages/workflow-framework
pnpm test          # must pass with no failures
pnpm typecheck     # must produce no type errors
```

Tests that only document existing behaviour (no assertion on new code) will not be accepted.

### 5. Update the schema if needed

If you add a new field to `devex.yaml`:
- Update `src/config/devex-config.schema.ts` (Zod schema).
- Update `devex.schema.json` (JSON Schema for the YAML language server).
- Both must stay in sync — the JSON Schema is generated from the Zod schema by convention.
- Add a test in `test/validate-config.test.ts` covering the new field.

### 6. Open a pull request

PR title format:
```
[DEVEX-<n>] <Short description>
```

The PR body must include:
- **Work ID** linked to the issue or work item.
- **What changed** — a brief summary of the code change.
- **Why** — the motivation or problem being solved.
- **Test evidence** — confirm tests pass locally (`pnpm test`).
- **Breaking changes** — yes or no; if yes, describe the migration path.
- **Affected teams** — list any service teams that will need to update their `devex.yaml` or pinned version.

### 7. Review requirements

- The PR requires **two approving reviews** from contributors with write access.
- At least one reviewer must be from the platform team.
- All CI checks (governance, tests, typecheck) must pass before merge.
- Reviewers may request changes; address all feedback before requesting re-review.

---

## Breaking changes policy

A breaking change is any modification that requires service repositories to:
- Change their `devex.yaml` structure.
- Update TypeScript import paths or types.
- Change their pinned version ref.

Breaking changes require:
1. A major version bump (`0.x.y → 1.0.0`).
2. A migration note in the PR description.
3. An updated example in the `devex.yaml` and `README.md`.
4. Notification to all known service teams before the release tag is cut.

Non-breaking additions (new optional fields, new adapters, new exports) use a minor version bump.

---

## Release process (platform team)

After a feature PR is merged to `main`:

```bash
cd packages/workflow-framework

# 1. Create a release branch (main is protected — no direct pushes)
git checkout main && git pull
git checkout -b chore/DEVEX-<n>-release-v<new-version>

# 2. Bump version in package.json and create a local commit + tag
#    Replace "minor" with "patch" or "major" as appropriate
npm version minor

# 3. Push the branch (not main) and open a PR
git push origin chore/DEVEX-<n>-release-v<new-version>
# → open a PR titled "[DEVEX-<n>] Release v<new-version>"

# 4. After the PR is approved and merged, push only the tag
#    Tags are not subject to branch protection rules
git push origin v<new-version>
```

Service repos then update their pinned ref:

```bash
pnpm add -D github:evertonjuniti/loanprochallenge#v0.2.0
```

---

## Code style

- TypeScript strict mode is enabled — no `any`, no implicit `undefined`.
- All public functions must have a JSDoc comment describing their purpose and parameters.
- Use `zod` for all runtime validation; do not use `as` casts to bypass types.
- Prefer pure functions. Avoid module-level side effects.
- File names use `kebab-case.ts`.

---

## Questions and support

Open a GitHub Issue tagged `question` or `enhancement` at:
https://github.com/evertonjuniti/loanprochallenge/issues
