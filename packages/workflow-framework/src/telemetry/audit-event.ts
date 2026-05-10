import {
  type BaseTelemetryEvent,
  type DeploymentEventType,
  type GovernanceEventType,
  type TestEventType,
  type CdkEventType,
  createBaseEvent,
} from "./telemetry-event.js";

// ---------------------------------------------------------------------------
// Audit event: captures the complete WHO / WHAT / WHEN / WHERE / WHY
// ---------------------------------------------------------------------------

/**
 * An AuditEvent records a significant action that occurred during the
 * pipeline and must be traceable for compliance purposes.
 *
 * Every audit event is appended to `dora-events.ndjson` and optionally
 * shipped to secondary sinks (S3, CloudWatch, EventBridge).
 *
 * Example NDJSON line:
 * {
 *   "schemaVersion": "1.0",
 *   "eventType": "deployment_succeeded",
 *   "timestamp": "2026-05-09T12:30:00Z",
 *   "actor": "octocat",
 *   "repository": "your-org/transactionify",
 *   "workflowRunId": "123456",
 *   "sha": "abc123",
 *   "workId": "FIN-123",
 *   "environment": "sandbox",
 *   "stage": "deploy-sandbox",
 *   "why": "https://github.com/your-org/transactionify/pull/42",
 *   "result": "success"
 * }
 */
export interface AuditEvent extends BaseTelemetryEvent {
  /**
   * The pipeline stage that emitted this event.
   * E.g. "governance", "small-tests", "cdk-synth", "deploy-sandbox".
   */
  stage: string;

  /**
   * The target deployment environment, if applicable.
   * Null for non-deployment events (governance, tests, synth).
   */
  environment: string | null;

  /** Final outcome of the stage. */
  result: "success" | "failure" | "skipped" | "in-progress";

  /**
   * Optional human-readable message that supplements the result.
   * E.g. the first line of a test failure or a CDK error.
   */
  message?: string;

  /**
   * Duration of the stage in milliseconds.
   * Set when the stage completes; absent when emitted as "in-progress".
   */
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Specialised audit event sub-types
// ---------------------------------------------------------------------------

export interface GovernanceAuditEvent extends AuditEvent {
  eventType: GovernanceEventType;
  stage: "governance";
  environment: null;
  /** List of governance rule violations; empty when result = "success". */
  violations: string[];
}

export interface TestAuditEvent extends AuditEvent {
  eventType: TestEventType;
  stage: "small-tests";
  environment: null;
  /** Number of tests executed. */
  totalTests?: number;
  /** Number of failing tests. */
  failedTests?: number;
}

export interface CdkSynthAuditEvent extends AuditEvent {
  eventType: CdkEventType;
  stage: "cdk-synth";
  environment: null;
  /** CDK working directory relative to repository root. */
  cdkWorkingDirectory: string;
}

export interface DeploymentAuditEvent extends AuditEvent {
  eventType: DeploymentEventType;
  /** The CDK stack name that was deployed. */
  cdkStack: string;
  /** AWS region the stack was deployed to. */
  awsRegion: string;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

type BaseAuditEventInput = Omit<AuditEvent, "schemaVersion" | "timestamp"> &
  Partial<Pick<AuditEvent, "timestamp">>;

export function createAuditEvent(input: BaseAuditEventInput): AuditEvent {
  return {
    schemaVersion: "1.0",
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input,
  };
}

export function createDeploymentAuditEvent(
  input: Omit<DeploymentAuditEvent, "schemaVersion" | "timestamp"> &
    Partial<Pick<DeploymentAuditEvent, "timestamp">>
): DeploymentAuditEvent {
  return {
    schemaVersion: "1.0",
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input,
  };
}

export function createGovernanceAuditEvent(
  input: Omit<GovernanceAuditEvent, "schemaVersion" | "timestamp" | "stage" | "environment"> &
    Partial<Pick<GovernanceAuditEvent, "timestamp">>
): GovernanceAuditEvent {
  return {
    schemaVersion: "1.0",
    timestamp: input.timestamp ?? new Date().toISOString(),
    stage: "governance",
    environment: null,
    ...input,
  };
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

/**
 * Serialises an array of audit events to NDJSON format.
 * Each line is a complete, self-describing JSON object.
 */
export function toNdjson(events: AuditEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
