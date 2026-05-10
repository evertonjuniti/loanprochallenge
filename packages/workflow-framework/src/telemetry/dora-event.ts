import type { DeploymentAuditEvent } from "./audit-event.js";

// ---------------------------------------------------------------------------
// DORA metric event
// ---------------------------------------------------------------------------

/**
 * A DoraEvent is a specialised audit event that carries the signals needed
 * to compute DORA metrics.
 *
 * The four DORA metrics and their event sources:
 *
 * ┌─────────────────────────────┬───────────────────────────────────────────────┐
 * │ Metric                      │ How it is computed from events                │
 * ├─────────────────────────────┼───────────────────────────────────────────────┤
 * │ Deployment Frequency        │ Count production deployment_succeeded events  │
 * │ Lead Time for Changes       │ deployment_succeeded.timestamp                │
 * │                             │   − firstCommitAt (same workId or sha)        │
 * │ Change Failure Rate         │ deployment_failed / total production deploys  │
 * │ MTTR                        │ incident_resolved.ts − incident_detected.ts   │
 * └─────────────────────────────┴───────────────────────────────────────────────┘
 */
export interface DoraEvent {
  schemaVersion: "1.0";

  /**
   * Identifies the DORA signal carried by this event.
   *
   * deployment_succeeded  → contributes to Deployment Frequency and Lead Time
   * deployment_failed     → contributes to Change Failure Rate
   * deployment_rolled_back→ contributes to Change Failure Rate
   * incident_detected     → opens an MTTR window
   * incident_resolved     → closes an MTTR window
   */
  doraEventType:
    | "deployment_succeeded"
    | "deployment_failed"
    | "deployment_rolled_back"
    | "incident_detected"
    | "incident_resolved";

  timestamp: string;
  actor: string;
  repository: string;
  workflowRunId: string;
  sha: string;
  workId: string | null;

  /**
   * Only populated for deployment-related events.
   * Must be "production" for Deployment Frequency and Lead Time calculations.
   */
  environment: string | null;

  /**
   * The CDK stack deployed (for deployment events).
   */
  cdkStack?: string;

  /**
   * ISO-8601 UTC timestamp of the first commit for this Work ID or SHA.
   * Populated by the CI system reading the git log.
   * Required to compute Lead Time for Changes.
   */
  firstCommitAt?: string;

  /**
   * Computed lead time in seconds.
   * Set by the DORA summary job when firstCommitAt is available.
   */
  leadTimeSeconds?: number;

  /**
   * For incident events: a label or identifier from the incident tracking system.
   */
  incidentId?: string;

  /**
   * Link to the PR, issue, or incident report.
   */
  why?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDoraDeploymentEvent(
  params: Pick<
    DoraEvent,
    | "doraEventType"
    | "actor"
    | "repository"
    | "workflowRunId"
    | "sha"
    | "workId"
    | "environment"
  > &
    Partial<Pick<DoraEvent, "cdkStack" | "firstCommitAt" | "leadTimeSeconds" | "why" | "timestamp">>
): DoraEvent {
  return {
    schemaVersion: "1.0",
    timestamp: params.timestamp ?? new Date().toISOString(),
    ...params,
  };
}

// ---------------------------------------------------------------------------
// DORA metric aggregation helpers (used by the summary job)
// ---------------------------------------------------------------------------

export interface DoraMetricsSummary {
  /** Total production deployments in the sample window. */
  deploymentCount: number;

  /** Deployments that failed or were rolled back. */
  failedDeploymentCount: number;

  /** Change Failure Rate as a fraction (0 – 1). */
  changeFailureRate: number;

  /** Average lead time in seconds across events that have firstCommitAt set. */
  averageLeadTimeSeconds: number | null;

  /** Minimum lead time in seconds. */
  minLeadTimeSeconds: number | null;

  /** Maximum lead time in seconds. */
  maxLeadTimeSeconds: number | null;
}

/**
 * Computes high-level DORA metrics from a list of DoraEvents.
 * Only considers production environment events for Deployment Frequency and CFR.
 */
export function computeDoraMetrics(events: DoraEvent[]): DoraMetricsSummary {
  const productionDeployments = events.filter(
    (e) =>
      e.environment === "production" &&
      (e.doraEventType === "deployment_succeeded" ||
        e.doraEventType === "deployment_failed" ||
        e.doraEventType === "deployment_rolled_back")
  );

  const deploymentCount = productionDeployments.filter(
    (e) => e.doraEventType === "deployment_succeeded"
  ).length;

  const failedDeploymentCount = productionDeployments.filter(
    (e) =>
      e.doraEventType === "deployment_failed" ||
      e.doraEventType === "deployment_rolled_back"
  ).length;

  const total = deploymentCount + failedDeploymentCount;
  const changeFailureRate = total > 0 ? failedDeploymentCount / total : 0;

  const leadTimes = productionDeployments
    .filter(
      (e): e is DoraEvent & { leadTimeSeconds: number } =>
        typeof e.leadTimeSeconds === "number"
    )
    .map((e) => e.leadTimeSeconds);

  const averageLeadTimeSeconds =
    leadTimes.length > 0
      ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
      : null;

  const minLeadTimeSeconds =
    leadTimes.length > 0 ? Math.min(...leadTimes) : null;

  const maxLeadTimeSeconds =
    leadTimes.length > 0 ? Math.max(...leadTimes) : null;

  return {
    deploymentCount,
    failedDeploymentCount,
    changeFailureRate,
    averageLeadTimeSeconds,
    minLeadTimeSeconds,
    maxLeadTimeSeconds,
  };
}

/**
 * Renders a DORA metrics summary as a GitHub step summary Markdown table.
 */
export function renderDoraSummaryMarkdown(
  summary: DoraMetricsSummary,
  workId: string | null,
  environment: string
): string {
  const leadTimeDisplay =
    summary.averageLeadTimeSeconds != null
      ? `${(summary.averageLeadTimeSeconds / 3600).toFixed(1)}h avg`
      : "N/A (firstCommitAt not set)";

  const cfrPercent = (summary.changeFailureRate * 100).toFixed(1);

  return [
    `## DORA Metrics Summary`,
    ``,
    `| Metric | Value |`,
    `|---|---|`,
    `| Work ID | ${workId ?? "N/A"} |`,
    `| Environment | ${environment} |`,
    `| Successful Deployments | ${summary.deploymentCount} |`,
    `| Failed / Rolled Back | ${summary.failedDeploymentCount} |`,
    `| Change Failure Rate | ${cfrPercent}% |`,
    `| Lead Time for Changes | ${leadTimeDisplay} |`,
    ``,
  ].join("\n");
}
