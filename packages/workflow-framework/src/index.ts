/**
 * @loanpro/devex-workflow-framework — public API
 *
 * Phase 1 — Contract layer:
 *   - DevexConfig Zod schema and inferred TypeScript types
 *   - Config loader (YAML → validated DevexConfig)
 *   - Config validators (validateConfig, assertValidConfig, validateWorkflowRef)
 *   - Work ID governance utilities (validate, extract, build)
 *   - Telemetry event types (BaseTelemetryEvent, AuditEvent, DoraEvent)
 *   - DORA metric aggregation and Markdown rendering
 *
 * Phase 2 — Component B foundation:
 *   - Language adapters (LanguageAdapter interface, PythonAdapter, TypescriptAdapter)
 *   - Adapter registry (resolveAdapter, supportedLanguages)
 *   - GitHub Artifact telemetry sink (appendEventsToFile, readEventsFromFile)
 */

// Config schema and types
export * from "./config/devex-config.schema.js";
export * from "./config/validate-config.js";
export * from "./config/load-config.js";

// Governance
export * from "./governance/work-id.js";

// Telemetry
export * from "./telemetry/telemetry-event.js";
export * from "./telemetry/audit-event.js";
export * from "./telemetry/dora-event.js";
export * from "./telemetry/github-artifact-sink.js";

// Adapters
export * from "./adapters/language-adapter.js";
export * from "./adapters/index.js";
