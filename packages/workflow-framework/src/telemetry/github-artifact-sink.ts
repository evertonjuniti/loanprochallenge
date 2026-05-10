import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuditEvent } from "./audit-event.js";
import type { DoraEvent } from "./dora-event.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Any event that can be written through this sink. */
export type SinkEvent = AuditEvent | DoraEvent;

export interface SinkOptions {
  /**
   * Absolute or relative path to the NDJSON output file.
   * Defaults to `dora-events.ndjson` in the current working directory.
   */
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Serialises one or more events as NDJSON and appends them to the output file.
 *
 * The file and any intermediate directories are created automatically if they
 * do not exist. Multiple calls to this function safely accumulate events in
 * the same file — safe for concurrent steps that run sequentially in a job.
 *
 * In GitHub Actions, the output file should then be uploaded as a workflow
 * artifact so the DORA summary job (and downstream tools) can consume it:
 *
 * ```yaml
 * - uses: actions/upload-artifact@v4
 *   with:
 *     name: dora-events
 *     path: dora-events.ndjson
 * ```
 *
 * @example
 * appendEventsToFile([deploymentEvent]);
 * appendEventsToFile([auditEvent], { outputPath: ".devex/telemetry.ndjson" });
 */
export function appendEventsToFile(
  events: SinkEvent[],
  options: SinkOptions = {}
): void {
  if (events.length === 0) return;

  const outputPath = resolve(options.outputPath ?? "dora-events.ndjson");
  const dir = dirname(outputPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(outputPath, lines, "utf-8");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Reads all events from an NDJSON file written by `appendEventsToFile`.
 *
 * Returns an empty array if the file does not exist. Skips blank lines.
 * Throws a `SyntaxError` if a line is not valid JSON.
 *
 * Use this in the DORA summary job to load events emitted across all
 * previous jobs:
 *
 * @example
 * const events = readEventsFromFile<DoraEvent>({ outputPath: "dora-events.ndjson" });
 * const summary = computeDoraMetrics(events);
 */
export function readEventsFromFile<T extends SinkEvent>(
  options: SinkOptions = {}
): T[] {
  const outputPath = resolve(options.outputPath ?? "dora-events.ndjson");

  if (!existsSync(outputPath)) return [];

  const content = readFileSync(outputPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

// ---------------------------------------------------------------------------
// GitHub step summary helper
// ---------------------------------------------------------------------------

/**
 * Writes a Markdown string to the GitHub Actions step summary.
 *
 * The summary is written to the file referenced by `GITHUB_STEP_SUMMARY`.
 * If the environment variable is not set (e.g. local development), the
 * function is a no-op and returns false.
 *
 * @returns `true` if the summary was written, `false` otherwise.
 *
 * @example
 * writeStepSummary(renderDoraSummaryMarkdown(summary, workId, "production"));
 */
export function writeStepSummary(markdown: string): boolean {
  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (!summaryPath) return false;

  appendFileSync(resolve(summaryPath), markdown + "\n", "utf-8");
  return true;
}
