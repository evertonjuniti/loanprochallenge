/**
 * @loanpro/devex-workflow-framework — public API
 *
 * Phase 1 exports: the shared contract layer.
 *   - DevexConfig schema and types
 *   - Config loading and validation utilities
 *   - Telemetry event types and factories
 *   - DORA metric types, aggregation, and rendering
 *   - Work ID governance utilities
 *
 * Phase 2 exports: language adapters.
 *   - LanguageAdapter interface and WorkflowStep primitive
 *   - PythonAdapter
 *   - resolveAdapter() registry
 */

// Config schema
export * from "./config/devex-config.schema.js";
export * from "./config/validate-config.js";

// Telemetry
export * from "./telemetry/telemetry-event.js";
export * from "./telemetry/audit-event.js";
export * from "./telemetry/dora-event.js";

// Governance
export * from "./governance/work-id.js";

// Adapters
export * from "./adapters/language-adapter.js";
export * from "./adapters/index.js";
