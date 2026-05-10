/**
 * Base telemetry event schema shared by both DORA and audit events.
 *
 * All events emitted by the workflow framework or CLI must include these fields.
 * This ensures consistent querying across Python, Go, Clojure, and TypeScript teams.
 */

// ---------------------------------------------------------------------------
// Allowed event types
// ---------------------------------------------------------------------------

/** Events emitted during CI/CD pipeline execution. */
export type PipelineEventType =
  | "pipeline_started"
  | "pipeline_succeeded"
  | "pipeline_failed"
  | "pipeline_cancelled";

/** Events emitted during governance checks. */
export type GovernanceEventType =
  | "governance_passed"
  | "governance_failed";

/** Events emitted during the small-tests stage. */
export type TestEventType =
  | "tests_started"
  | "tests_succeeded"
  | "tests_failed";

/** Events emitted during CDK operations. */
export type CdkEventType =
  | "cdk_synth_started"
  | "cdk_synth_succeeded"
  | "cdk_synth_failed"
  | "cdk_diff_started"
  | "cdk_diff_succeeded"
  | "cdk_diff_failed";

/** Events emitted during deployments — core DORA signals. */
export type DeploymentEventType =
  | "deployment_started"
  | "deployment_succeeded"
  | "deployment_failed"
  | "deployment_rolled_back";

/** Events emitted when an incident is opened or resolved — used for MTTR. */
export type IncidentEventType =
  | "incident_detected"
  | "incident_resolved";

/** All event types understood by the framework. */
export type TelemetryEventType =
  | PipelineEventType
  | GovernanceEventType
  | TestEventType
  | CdkEventType
  | DeploymentEventType
  | IncidentEventType;

// ---------------------------------------------------------------------------
// Environment names
// ---------------------------------------------------------------------------

export type EnvironmentName = string; // Intentionally open; validated against devex.yaml

// ---------------------------------------------------------------------------
// Base event
// ---------------------------------------------------------------------------

/**
 * Every telemetry event must include these fields.
 * Higher-level event types extend this interface.
 */
export interface BaseTelemetryEvent {
  /** Semantic version of this event schema. Increment when fields are added/removed. */
  schemaVersion: "1.0";

  /** Discriminates between event subtypes. */
  eventType: TelemetryEventType;

  /** ISO-8601 UTC timestamp at which the event occurred. */
  timestamp: string;

  /** GitHub username or system identity that triggered the event. */
  actor: string;

  /** Full repository slug, e.g. "your-org/transactionify". */
  repository: string;

  /** GitHub Actions workflow run ID as a string. */
  workflowRunId: string;

  /** Full commit SHA that was processed. */
  sha: string;

  /**
   * Work tracking ID extracted from the branch name or commit message.
   * Example: "FIN-123". Null when the event is emitted before governance runs.
   */
  workId: string | null;

  /**
   * Human-readable link that explains WHY this event occurred.
   * Usually the PR URL or issue URL.
   */
  why: string | null;
}

// ---------------------------------------------------------------------------
// Helper constructors
// ---------------------------------------------------------------------------

/**
 * Returns an ISO-8601 UTC timestamp string for the current moment.
 * Use this when creating events inside GitHub Actions steps.
 */
export function nowUtc(): string {
  return new Date().toISOString();
}

/**
 * Creates a partial base event with required fields, leaving optional context
 * fields for the caller to fill in.
 */
export function createBaseEvent(
  overrides: Partial<BaseTelemetryEvent> & {
    eventType: TelemetryEventType;
    actor: string;
    repository: string;
    workflowRunId: string;
    sha: string;
  }
): BaseTelemetryEvent {
  return {
    schemaVersion: "1.0",
    timestamp: nowUtc(),
    workId: null,
    why: null,
    ...overrides,
  };
}
