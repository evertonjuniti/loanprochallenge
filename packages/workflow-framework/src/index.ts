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
 *
 * Phase 3 — Typed PR workflow generator:
 *   - GithubWorkflow / GithubJob / GithubStep types
 *   - Job builders (governance, small-tests, cdk-synth, deploy, dora-audit)
 *   - createPrWorkflow(config) — assembles the complete PR pipeline
 *   - renderWorkflowYaml(workflow) — serialises to GitHub Actions YAML
 *
 * Phase 4 — CDK constructs:
 *   - GoldenLambdaApi — Python Lambda + API Gateway + alarms + standard tags
 *   - applyGoldenPathTags — applies devex:* tags to any CDK construct scope
 *   Requires aws-cdk-lib ^2.0.0 and constructs ^10.0.0 (peer dependencies).
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

// GitHub workflow generator (Phase 3)
export * from "./github/types.js";
export * from "./github/steps.js";
export * from "./github/jobs/governance-job.js";
export * from "./github/jobs/small-tests-job.js";
export * from "./github/jobs/cdk-synth-job.js";
export * from "./github/jobs/deploy-job.js";
export * from "./github/jobs/dora-job.js";
export * from "./github/workflows/create-pr-workflow.js";

// CDK constructs (Phase 4) — requires aws-cdk-lib ^2.0.0 + constructs ^10.0.0
export * from "./cdk/tagging.js";
export * from "./cdk/golden-lambda-api.js";
