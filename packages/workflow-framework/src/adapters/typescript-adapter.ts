import type { DevexConfig } from "../config/devex-config.schema.js";
import type { LanguageAdapter, WorkflowStep } from "./language-adapter.js";

// ---------------------------------------------------------------------------
// Default commands
// ---------------------------------------------------------------------------

const DEFAULTS = {
  /** pnpm is the recommended package manager for TypeScript services in LoanPro.
   * --no-frozen-lockfile is required when no pnpm-lock.yaml is committed. */
  setup: "pnpm install --no-frozen-lockfile",
  unit: "pnpm test",
  property: "pnpm run test:property",
  contract: "pnpm run test:contract",
  lint: "pnpm run lint",
  /** Default Node.js version installed by actions/setup-node. */
  nodeVersion: "24",
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

// ---------------------------------------------------------------------------
// TypescriptAdapter
// ---------------------------------------------------------------------------

/**
 * Language adapter for TypeScript services managed with `pnpm`.
 *
 * The adapter targets the standard LoanPro TypeScript stack:
 *   - Runtime managed by Node.js ≥24
 *   - Package management with `pnpm`
 *   - Tests with `vitest` (via `pnpm test`)
 *   - Linting with `eslint` (via `pnpm run lint`)
 *
 * Commands are resolved in priority order:
 *   1. Value from `devex.yaml` (`ci.smallTests.*` or `local.*`)
 *   2. Adapter default
 *
 * This means teams can override any command in `devex.yaml` without
 * forking or modifying the adapter.
 */
export class TypescriptAdapter implements LanguageAdapter {
  readonly name = "typescript";

  /**
   * Installs Node.js and project dependencies.
   *
   * Steps:
   * 1. actions/setup-node — installs the configured Node.js version.
   * 2. Enable corepack — activates the pnpm shim bundled with Node.
   * 3. pnpm install --frozen-lockfile — installs from the lockfile exactly.
   */
  setupSteps(_config: DevexConfig): WorkflowStep[] {
    return [
      {
        name: "Set up Node.js",
        uses: "actions/setup-node@v4",
        with: {
          "node-version": DEFAULTS.nodeVersion,
        },
      },
      {
        name: "Enable corepack (pnpm)",
        run: "corepack enable",
      },
      {
        name: "Install dependencies",
        run: DEFAULTS.setup,
      },
    ];
  }

  /**
   * Runs unit tests (vitest by default).
   * Prefers `config.ci.smallTests.unit`, falls back to `pnpm test`.
   */
  unitTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.unit, DEFAULTS.unit);
    return [
      {
        name: "Run unit tests",
        run: cmd,
      },
    ];
  }

  /**
   * Runs property-based tests.
   * Prefers `config.ci.smallTests.property`, falls back to `pnpm run test:property`.
   */
  propertyTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.property, DEFAULTS.property);
    return [
      {
        name: "Run property-based tests",
        run: cmd,
      },
    ];
  }

  /**
   * Runs API contract tests.
   * Prefers `config.ci.smallTests.contract`, falls back to `pnpm run test:contract`.
   */
  contractTestSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.contract, DEFAULTS.contract);
    return [
      {
        name: "Run contract tests",
        run: cmd,
      },
    ];
  }

  /**
   * Runs ESLint.
   * Prefers `config.ci.smallTests.lint`, falls back to `pnpm run lint`.
   */
  lintSteps(config: DevexConfig): WorkflowStep[] {
    const cmd = firstDefined(config.ci?.smallTests?.lint, DEFAULTS.lint);
    return [
      {
        name: "Lint (eslint)",
        run: cmd,
      },
    ];
  }
}
