import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nowUtc,
  createBaseEvent,
  toNdjson,
  createAuditEvent,
  createDeploymentAuditEvent,
  createGovernanceAuditEvent,
  createDoraDeploymentEvent,
  computeDoraMetrics,
  appendEventsToFile,
  readEventsFromFile,
  writeStepSummary,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// nowUtc
// ---------------------------------------------------------------------------

describe("nowUtc", () => {
  it("returns a valid ISO-8601 UTC string", () => {
    const ts = nowUtc();
    expect(() => new Date(ts)).not.toThrow();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(ts.endsWith("Z")).toBe(true);
  });

  it("returned timestamp is close to the current time", () => {
    const before = Date.now();
    const ts = nowUtc();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// createBaseEvent
// ---------------------------------------------------------------------------

describe("createBaseEvent", () => {
  const base = {
    eventType: "deployment_succeeded" as const,
    actor: "octocat",
    repository: "acme/transactionify",
    workflowRunId: "999",
    sha: "abc123",
  };

  it("sets schemaVersion to 1.0", () => {
    expect(createBaseEvent(base).schemaVersion).toBe("1.0");
  });

  it("defaults workId to null", () => {
    expect(createBaseEvent(base).workId).toBeNull();
  });

  it("defaults why to null", () => {
    expect(createBaseEvent(base).why).toBeNull();
  });

  it("allows overriding workId", () => {
    const event = createBaseEvent({ ...base, workId: "FIN-123" });
    expect(event.workId).toBe("FIN-123");
  });

  it("includes a timestamp by default", () => {
    const event = createBaseEvent(base);
    expect(event.timestamp).toBeTruthy();
    expect(() => new Date(event.timestamp)).not.toThrow();
  });

  it("uses the provided timestamp override", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const event = createBaseEvent({ ...base, timestamp: ts });
    expect(event.timestamp).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// createAuditEvent
// ---------------------------------------------------------------------------

describe("createAuditEvent", () => {
  it("sets schemaVersion to 1.0", () => {
    const event = createAuditEvent({
      eventType: "governance_passed",
      actor: "octocat",
      repository: "acme/transactionify",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      why: null,
      stage: "governance",
      environment: null,
      result: "success",
    });
    expect(event.schemaVersion).toBe("1.0");
  });

  it("defaults timestamp when not provided", () => {
    const event = createAuditEvent({
      eventType: "tests_succeeded",
      actor: "octocat",
      repository: "acme/transactionify",
      workflowRunId: "1",
      sha: "abc",
      workId: null,
      why: null,
      stage: "small-tests",
      environment: null,
      result: "success",
    });
    expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("uses the provided timestamp", () => {
    const ts = "2026-05-10T10:00:00.000Z";
    const event = createAuditEvent({
      eventType: "tests_failed",
      actor: "ci-bot",
      repository: "acme/transactionify",
      workflowRunId: "2",
      sha: "def",
      workId: "FIN-2",
      why: null,
      stage: "small-tests",
      environment: null,
      result: "failure",
      timestamp: ts,
    });
    expect(event.timestamp).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// createDeploymentAuditEvent
// ---------------------------------------------------------------------------

describe("createDeploymentAuditEvent", () => {
  const deployInput = {
    eventType: "deployment_succeeded" as const,
    actor: "octocat",
    repository: "acme/transactionify",
    workflowRunId: "42",
    sha: "abc123",
    workId: "FIN-99",
    why: "https://github.com/acme/transactionify/pull/10",
    stage: "deploy-production",
    environment: "production",
    result: "success" as const,
    cdkStack: "TransactionifyProduction",
    awsRegion: "us-east-1",
  };

  it("sets schemaVersion to 1.0", () => {
    expect(createDeploymentAuditEvent(deployInput).schemaVersion).toBe("1.0");
  });

  it("preserves cdkStack and awsRegion", () => {
    const event = createDeploymentAuditEvent(deployInput);
    expect(event.cdkStack).toBe("TransactionifyProduction");
    expect(event.awsRegion).toBe("us-east-1");
  });
});

// ---------------------------------------------------------------------------
// createGovernanceAuditEvent
// ---------------------------------------------------------------------------

describe("createGovernanceAuditEvent", () => {
  it("always sets stage to governance and environment to null", () => {
    const event = createGovernanceAuditEvent({
      eventType: "governance_failed",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "5",
      sha: "aaa",
      workId: null,
      why: null,
      result: "failure",
      violations: ["Branch name missing Work ID"],
    });
    expect(event.stage).toBe("governance");
    expect(event.environment).toBeNull();
    expect(event.violations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// toNdjson
// ---------------------------------------------------------------------------

describe("toNdjson", () => {
  it("serialises each event to a separate JSON line", () => {
    const event = createAuditEvent({
      eventType: "governance_passed",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      why: null,
      stage: "governance",
      environment: null,
      result: "success",
    });
    const ndjson = toNdjson([event]);
    const lines = ndjson.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.eventType).toBe("governance_passed");
  });

  it("ends with a newline", () => {
    const event = createAuditEvent({
      eventType: "governance_passed",
      actor: "bot",
      repository: "r/r",
      workflowRunId: "1",
      sha: "a",
      workId: null,
      why: null,
      stage: "governance",
      environment: null,
      result: "success",
    });
    expect(toNdjson([event]).endsWith("\n")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createDoraDeploymentEvent
// ---------------------------------------------------------------------------

describe("createDoraDeploymentEvent", () => {
  it("sets schemaVersion to 1.0", () => {
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/transactionify",
      workflowRunId: "100",
      sha: "abc",
      workId: "FIN-5",
      environment: "production",
    });
    expect(event.schemaVersion).toBe("1.0");
  });

  it("defaults timestamp when not provided", () => {
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/transactionify",
      workflowRunId: "100",
      sha: "abc",
      workId: "FIN-5",
      environment: "production",
    });
    expect(event.timestamp).toBeTruthy();
  });

  it("uses provided timestamp", () => {
    const ts = "2026-01-01T00:00:00.000Z";
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/transactionify",
      workflowRunId: "100",
      sha: "abc",
      workId: "FIN-5",
      environment: "production",
      timestamp: ts,
    });
    expect(event.timestamp).toBe(ts);
  });
});

// ---------------------------------------------------------------------------
// GitHub Artifact Sink — appendEventsToFile / readEventsFromFile
// ---------------------------------------------------------------------------

const TMP_DIR = resolve("test/__tmp_sink__");
const TMP_FILE = resolve(TMP_DIR, "events.ndjson");

describe("appendEventsToFile / readEventsFromFile", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  });

  it("creates the file if it does not exist", () => {
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      environment: "production",
    });
    appendEventsToFile([event], { outputPath: TMP_FILE });
    expect(existsSync(TMP_FILE)).toBe(true);
  });

  it("appends events as NDJSON lines", () => {
    const e1 = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      environment: "production",
    });
    const e2 = createDoraDeploymentEvent({
      doraEventType: "deployment_failed",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "2",
      sha: "def",
      workId: "FIN-2",
      environment: "production",
    });
    appendEventsToFile([e1], { outputPath: TMP_FILE });
    appendEventsToFile([e2], { outputPath: TMP_FILE });

    const lines = readFileSync(TMP_FILE, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("readEventsFromFile returns empty array when file does not exist", () => {
    const events = readEventsFromFile({ outputPath: TMP_FILE });
    expect(events).toEqual([]);
  });

  it("round-trips events through write and read", () => {
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      environment: "production",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    appendEventsToFile([event], { outputPath: TMP_FILE });
    const [read] = readEventsFromFile({ outputPath: TMP_FILE });
    expect((read as typeof event).doraEventType).toBe("deployment_succeeded");
    expect((read as typeof event).workId).toBe("FIN-1");
  });

  it("is a no-op for an empty events array", () => {
    appendEventsToFile([], { outputPath: TMP_FILE });
    expect(existsSync(TMP_FILE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeStepSummary
// ---------------------------------------------------------------------------

describe("writeStepSummary", () => {
  it("returns false when GITHUB_STEP_SUMMARY is not set", () => {
    const original = process.env["GITHUB_STEP_SUMMARY"];
    delete process.env["GITHUB_STEP_SUMMARY"];
    expect(writeStepSummary("## Hello")).toBe(false);
    if (original !== undefined) process.env["GITHUB_STEP_SUMMARY"] = original;
  });

  it("writes to the summary file and returns true when GITHUB_STEP_SUMMARY is set", () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const summaryFile = resolve(TMP_DIR, "summary.md");
    process.env["GITHUB_STEP_SUMMARY"] = summaryFile;
    try {
      const result = writeStepSummary("## DORA Summary\nAll green.");
      expect(result).toBe(true);
      expect(existsSync(summaryFile)).toBe(true);
      expect(readFileSync(summaryFile, "utf-8")).toContain("DORA Summary");
    } finally {
      delete process.env["GITHUB_STEP_SUMMARY"];
    }
  });
});

// ---------------------------------------------------------------------------
// computeDoraMetrics (integration)
// ---------------------------------------------------------------------------

describe("computeDoraMetrics integration", () => {
  it("returns zero counts for an empty event list", () => {
    const summary = computeDoraMetrics([]);
    expect(summary.deploymentCount).toBe(0);
    expect(summary.changeFailureRate).toBe(0);
    expect(summary.averageLeadTimeSeconds).toBeNull();
  });

  it("counts production successes as deployments", () => {
    const event = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "abc",
      workId: "FIN-1",
      environment: "production",
    });
    const summary = computeDoraMetrics([event]);
    expect(summary.deploymentCount).toBe(1);
    expect(summary.failedDeploymentCount).toBe(0);
    expect(summary.changeFailureRate).toBe(0);
  });

  it("computes change failure rate correctly", () => {
    const success = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "a",
      workId: "FIN-1",
      environment: "production",
    });
    const failure = createDoraDeploymentEvent({
      doraEventType: "deployment_failed",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "2",
      sha: "b",
      workId: "FIN-2",
      environment: "production",
    });
    const summary = computeDoraMetrics([success, failure]);
    expect(summary.changeFailureRate).toBe(0.5);
  });

  it("ignores non-production events for deployment frequency", () => {
    const sandboxEvent = createDoraDeploymentEvent({
      doraEventType: "deployment_succeeded",
      actor: "octocat",
      repository: "acme/svc",
      workflowRunId: "1",
      sha: "a",
      workId: "FIN-1",
      environment: "sandbox",
    });
    const summary = computeDoraMetrics([sandboxEvent]);
    expect(summary.deploymentCount).toBe(0);
  });
});
