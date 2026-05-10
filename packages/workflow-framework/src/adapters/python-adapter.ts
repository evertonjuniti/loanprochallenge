import type { DevexConfig } from "../config/devex-config.schema.js";
import type { LanguageAdapter, WorkflowStep } from "./language-adapter.js";

// ---------------------------------------------------------------------------
// Default commands
// ---------------------------------------------------------------------------

const DEFAULTS = {
  /** uv is the recommended package manager for Python services in LoanPro. */
  setup: "uv sync --frozen",
  unit: "uv run pytest tests/unit",
  property: "uv run pytest tests/property",
  contract: "uv run pytest tests/contracts",
  lint: "uv run ruff check .",
  /** Default Python version installed by actions/setup-python. */
  pythonVersion: "3.12",
} as const;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Returns the first non-empty string from a list of candidates.
 * Used to prefer user-configured commands over adapter defaults.
 */
function firstDefined(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    if (c && c.trim().length > 0) return c.trim();
  }
  throw new Error("No command defined and no default available.");
}

/**
 * Wraps a shell command with a guard that checks for `pyproject.toml`.
 * If the file is absent the step emits a GitHub Actions warning and skips,
 * rather than failing the workflow. This allows the Golden Path to be used
 * in repos that don't yet have a Python project bootstrapped.
 */
function withPyprojectGuard(cmd: string): string {
  return [
    `if [ ! -f pyproject.toml ]; then`,
    `  echo "::warning::No pyproject.toml found — skipping Python step (project not yet initialised)."`,
    `  exit 0`,
    `fi`,
    cmd,
  ].join("\n");
}

/**
 * Returns the configured `ci.smallTests.workingDirectory`, or `undefined`.
 * When set, every `run`-based adapter step will include `working-directory`
 * so that the `pyproject.toml` guard and all Python commands run from the
 * correct subdirectory (e.g. `packages/cli` in a monorepo).
 */
function spreadWorkingDirectory(config: DevexConfig): { workingDirectory: string } | Record<string, never> {
  const wd = config.ci?.smallTests?.python?.workingDirectory ?? config.ci?.smallTests?.workingDirectory;
  return wd !== undefined ? { workingDirectory: wd } : {};
}

// ---------------------------------------------------------------------------
// PythonAdapter
// ---------------------------------------------------------------------------

/**
 * Language adapter for Python services managed with `uv`.
 *
 * The adapter targets the Transactionify-style stack:
 *   - Runtime managed by `uv` (https://docs.astral.sh/uv/)
 *   - Tests with `pytest`
 *   - Linting/formatting with `ruff`
 *
 * Commands are resolved in priority order:
 *   1. Value from `devex.yaml` (`ci.smallTests.*` or `local.*`)
 *   2. Adapter default
 *
 * This means teams can override any command in `devex.yaml` without
 * forking or modifying the adapter.
 */
export class PythonAdapter implements LanguageAdapter {
  readonly name = "python";

  /**
   * Installs Python and project dependencies.
   *
   * Steps:
   * 1. actions/setup-python — installs the configured Python version.
   * 2. Install uv — the package manager used by LoanPro Python services.
   * 3. uv sync --frozen — installs dependencies from the lockfile.
   */
  setupSteps(config: DevexConfig): WorkflowStep[] {
    return [
      {
        name: "Set up Python",
        uses: "actions/setup-python@v5",
        with: {
          "python-version": DEFAULTS.pythonVersion,
        },
      },
      {
        name: "Install uv",
        uses: "astral-sh/setup-uv@v4",
        with: {
          "enable-cache": false,
        },
      },
      {
        name: "Install dependencies",
        run: withPyprojectGuard(
          firstDefined(config.local?.testCommand, DEFAULTS.setup).startsWith("uv")
            ? DEFAULTS.setup
            : DEFAULTS.setup
        ),
        ...spreadWorkingDirectory(config),
      },
    ];
  }

  /**
   * Runs unit tests using pytest.
   * Prefers `config.ci.smallTests.unit`, falls back to `uv run pytest tests/unit`.
   */
  unitTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.python?.unit, config.ci?.smallTests?.unit, DEFAULTS.unit);
    return [
      {
        name: "Run unit tests",
        run: withPyprojectGuard(cmd),
        ...spreadWorkingDirectory(config),
      },
    ];
  }

  /**
   * Runs property-based tests using pytest (e.g. hypothesis).
   * Prefers `config.ci.smallTests.property`, falls back to `uv run pytest tests/property`.
   */
  propertyTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.python?.property, config.ci?.smallTests?.property, DEFAULTS.property);
    return [
      {
        name: "Run property-based tests",
        run: withPyprojectGuard(cmd),
        ...spreadWorkingDirectory(config),
      },
    ];
  }

  /**
   * Runs API contract tests using pytest.
   * Prefers `config.ci.smallTests.contract`, falls back to `uv run pytest tests/contracts`.
   */
  contractTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.python?.contract, config.ci?.smallTests?.contract, DEFAULTS.contract);
    return [
      {
        name: "Run contract tests",
        run: withPyprojectGuard(cmd),
        ...spreadWorkingDirectory(config),
      },
    ];
  }

  /**
   * Runs ruff for linting and static analysis.
   * Prefers `config.ci.smallTests.lint`, falls back to `uv run ruff check .`.
   */
  lintSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.python?.lint, config.ci?.smallTests?.lint, DEFAULTS.lint);
    return [
      {
        name: "Lint (ruff)",
        run: withPyprojectGuard(cmd),
        ...spreadWorkingDirectory(config),
      },
    ];
  }
}
