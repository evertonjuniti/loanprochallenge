import { z } from "zod";

// ---------------------------------------------------------------------------
// Work-tracking patterns
// ---------------------------------------------------------------------------

export const WorkTrackingSchema = z.object({
  /**
   * Regex that a Work ID must satisfy.
   * Example: "^[A-Z]+-[0-9]+$" matches JIRA-style IDs like FIN-123.
   */
  workIdPattern: z
    .string()
    .regex(/^\/?.+\/?$/, "Must be a valid regex string")
    .default("^[A-Z]+-[0-9]+$"),

  /**
   * Regex that branch names must satisfy.
   * Example: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$"
   */
  branchPattern: z
    .string()
    .default("^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$"),

  /**
   * Regex that individual commit messages must satisfy.
   * Example: "^\\[[A-Z]+-[0-9]+\\] .+"
   */
  commitPattern: z
    .string()
    .default("^\\[[A-Z]+-[0-9]+\\] .+"),

  /**
   * Regex that the PR title must satisfy.
   * Example: "^\\[[A-Z]+-[0-9]+\\] .+"
   */
  prTitlePattern: z
    .string()
    .default("^\\[[A-Z]+-[0-9]+\\] .+"),
});

// ---------------------------------------------------------------------------
// Runtime / language
// ---------------------------------------------------------------------------

export const AppLanguageSchema = z.enum([
  "python",
  "go",
  "typescript",
  "clojure",
  "java",
  "rust",
]);

export const InfraFrameworkSchema = z.enum([
  "aws-cdk-typescript",
  "terraform",
  "pulumi",
  "none",
]);

export const RuntimeSchema = z.object({
  /**
   * Application language(s). Use a single string for single-language repos;
   * use an array for polyglot monorepos (e.g. `[typescript, python]`).
   */
  appLanguage: z.union([AppLanguageSchema, z.array(AppLanguageSchema).min(1)]),
  infraLanguage: z.enum(["typescript", "python", "go", "hcl", "none"]).default("typescript"),
  infraFramework: InfraFrameworkSchema.default("aws-cdk-typescript"),
});

// ---------------------------------------------------------------------------
// Local commands
// ---------------------------------------------------------------------------

export const LocalCommandsSchema = z.object({
  testCommand: z.string().optional(),
  lintCommand: z.string().optional(),
  contractTestCommand: z.string().optional(),
  propertyTestCommand: z.string().optional(),
});

// ---------------------------------------------------------------------------
// CI configuration
// ---------------------------------------------------------------------------

/**
 * Shared command-override fields used both at the top level and inside
 * per-language sub-sections of `SmallTestsConfigSchema`.
 */
const SmallTestsLanguageConfigSchema = z.object({
  unit: z.string().optional(),
  property: z.string().optional(),
  contract: z.string().optional(),
  lint: z.string().optional(),
  typecheck: z.string().optional(),
  /**
   * Working directory for all test steps of this language.
   * Relative to the repository root. Used by the Python adapter to locate
   * `pyproject.toml` in a subdirectory (e.g. a monorepo's `packages/cli`).
   */
  workingDirectory: z.string().optional(),
});

export const SmallTestsConfigSchema = SmallTestsLanguageConfigSchema.extend({
  /**
   * Per-language command overrides for polyglot repos.
   * When present, the adapter for that language reads from here first,
   * then falls back to the top-level fields, then to adapter defaults.
   * Top-level fields are still used for single-language repos.
   */
  typescript: SmallTestsLanguageConfigSchema.optional(),
  python: SmallTestsLanguageConfigSchema.optional(),
});

export const CdkConfigSchema = z.object({
  workingDirectory: z.string().default("infra"),
  synthCommand: z.string().default("pnpm cdk synth"),
  diffCommand: z.string().default("pnpm cdk diff"),
  deployCommand: z.string().default("pnpm cdk deploy --require-approval never"),
});

export const CiConfigSchema = z.object({
  smallTests: SmallTestsConfigSchema.optional(),
  cdk: CdkConfigSchema.optional(),
});

// ---------------------------------------------------------------------------
// Environment definition
// ---------------------------------------------------------------------------

export const EnvironmentConfigSchema = z.object({
  awsRegion: z.string().default("us-east-1"),
  cdkStack: z.string(),
  githubEnvironment: z.string(),
  /** Optional: override the AWS account ID for this environment */
  awsAccountId: z.string().optional(),
  /** Optional: role ARN assumed via OIDC for deployment */
  roleArn: z.string().optional(),
});

export const EnvironmentsSchema = z
  .record(z.string(), EnvironmentConfigSchema)
  .refine(
    (envs) => Object.keys(envs).length >= 1,
    "At least one environment must be defined"
  );

// ---------------------------------------------------------------------------
// Telemetry sink
// ---------------------------------------------------------------------------

export const TelemetrySinkSchema = z.enum([
  "github-artifact",
  "cloudwatch",
  "eventbridge",
  "s3",
  "none",
]);

export const TelemetryConfigSchema = z.object({
  sink: TelemetrySinkSchema.default("github-artifact"),
  /** S3 bucket name, required when sink = "s3" */
  s3Bucket: z.string().optional(),
  /** CloudWatch log group, required when sink = "cloudwatch" */
  cloudwatchLogGroup: z.string().optional(),
  /** EventBridge bus name, required when sink = "eventbridge" */
  eventBridgeBus: z.string().optional(),
  auditFormat: z.enum(["ndjson", "json"]).default("ndjson"),
});

// ---------------------------------------------------------------------------
// Service metadata
// ---------------------------------------------------------------------------

export const ServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(
      /^[a-z][a-z0-9-]*$/,
      "Service name must be lowercase alphanumeric with hyphens"
    ),
  owner: z.string().min(1),
  type: z
    .enum(["microservice", "library", "platform-tool", "data-pipeline", "monolith"])
    .default("microservice"),
  /** Canonical repository URL (e.g. github.com/your-org/transactionify) */
  repositoryUrl: z.string().url().optional(),
});

// ---------------------------------------------------------------------------
// Workflow framework versioning
// ---------------------------------------------------------------------------

/**
 * Governs which version of the centralized reusable workflow is called.
 * Service repos must pin to an approved semver tag, not `main`.
 */
export const WorkflowVersionSchema = z.object({
  /**
   * Tag or commit SHA of @loanpro/devex-workflow-framework.
   * Must be a full semver tag (vMAJOR.MINOR.PATCH) or a full 40-char SHA.
   * Using "main" or "latest" is rejected by the governance job.
   */
  ref: z
    .string()
    .regex(
      /^(v\d+\.\d+\.\d+|[0-9a-f]{40})$/,
      "Must be a semver tag (e.g. v0.1.0) or a full 40-character SHA"
    ),
});

// ---------------------------------------------------------------------------
// Root devex.yaml schema
// ---------------------------------------------------------------------------

export const DevexConfigSchema = z.object({
  /**
   * Schema version for forward-compatibility checks.
   * Increment the minor when new optional fields are added.
   * Increment the major when breaking changes occur.
   */
  schemaVersion: z.literal(1),

  service: ServiceSchema,

  workTracking: WorkTrackingSchema.optional().default({}),

  runtime: RuntimeSchema,

  local: LocalCommandsSchema.optional().default({}),

  ci: CiConfigSchema.optional().default({}),

  environments: EnvironmentsSchema,

  telemetry: TelemetryConfigSchema.optional().default({}),

  /**
   * Pin the centralized reusable workflow version used by this service.
   * The governance job will reject calls to non-pinned refs.
   */
  workflowVersion: WorkflowVersionSchema.optional(),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types
// ---------------------------------------------------------------------------

export type DevexConfig = z.infer<typeof DevexConfigSchema>;
export type ServiceConfig = z.infer<typeof ServiceSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeSchema>;
export type WorkTrackingConfig = z.infer<typeof WorkTrackingSchema>;
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>;
export type CiConfig = z.infer<typeof CiConfigSchema>;
export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;
export type AppLanguage = z.infer<typeof AppLanguageSchema>;
export type InfraFramework = z.infer<typeof InfraFrameworkSchema>;
export type TelemetrySink = z.infer<typeof TelemetrySinkSchema>;
