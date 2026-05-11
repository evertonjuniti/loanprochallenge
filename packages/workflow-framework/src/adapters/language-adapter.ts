import type { DevexConfig } from "../config/devex-config.schema.js";

// ---------------------------------------------------------------------------
// Workflow step primitive
// ---------------------------------------------------------------------------

/**
 * A single step inside a GitHub Actions job.
 * Adapters return arrays of these to be serialised into the generated workflow.
 */
export interface WorkflowStep {
  /** Display name shown in the GitHub Actions UI. */
  name: string;

  /**
   * Shell command to run.
   * Mutually exclusive with `uses`.
   */
  run?: string;

  /**
   * GitHub Actions action reference (e.g. "actions/setup-python@v5").
   * Mutually exclusive with `run`.
   */
  uses?: string;

  /** Input parameters for an action referenced by `uses`. */
  with?: Record<string, string | number | boolean>;

  /** Environment variables scoped to this step. */
  env?: Record<string, string>;

  /** If true, the step is allowed to fail without failing the job. */
  continueOnError?: boolean;

  /** Condition expression (GitHub Actions `if:` syntax). */
  condition?: string;

  /**
   * Override the working directory for this step.
   * Maps to GitHub Actions `working-directory`. Only applies to `run` steps.
   */
  workingDirectory?: string;
}

// ---------------------------------------------------------------------------
// LanguageAdapter interface
// ---------------------------------------------------------------------------

/**
 * A LanguageAdapter encapsulates all the CI knowledge needed to set up and
 * test a service written in a specific language.
 *
 * Each adapter returns arrays of WorkflowStep objects. The workflow generator
 * (Phase 3) injects these steps into the appropriate jobs of the generated
 * GitHub Actions workflow.
 *
 * Implementing a new adapter allows a team to bring first-class Golden Path
 * support for their language without touching the core workflow logic.
 *
 * @example
 * const adapter = resolveAdapter(config);
 * const steps = [
 *   ...adapter.setupSteps(config),
 *   ...adapter.unitTestSteps(config),
 * ];
 */
export interface LanguageAdapter {
  /**
   * The language this adapter handles.
   * Must match a value from AppLanguageSchema.
   */
  readonly name: string;

  /**
   * Steps that install the language runtime and project dependencies.
   * These run at the start of every CI job that executes application code.
   */
  setupSteps(config: DevexConfig): WorkflowStep[];

  /**
   * Steps that execute unit tests.
   * Uses commands from `config.ci.smallTests.unit` when set,
   * otherwise falls back to adapter defaults.
   */
  unitTestSteps(config: DevexConfig): WorkflowStep[];

  /**
   * Steps that execute property-based tests.
   * Uses commands from `config.ci.smallTests.property` when set.
   */
  propertyTestSteps(config: DevexConfig): WorkflowStep[];

  /**
   * Steps that execute API contract tests.
   * Uses commands from `config.ci.smallTests.contract` when set.
   */
  contractTestSteps(config: DevexConfig): WorkflowStep[];

  /**
   * Steps that run linters and static analysis.
   * Uses commands from `config.ci.smallTests.lint` when set.
   */
  lintSteps(config: DevexConfig): WorkflowStep[];
}
