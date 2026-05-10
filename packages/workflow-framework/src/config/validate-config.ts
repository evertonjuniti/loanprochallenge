import { ZodError } from "zod";
import { DevexConfigSchema, type DevexConfig } from "./devex-config.schema.js";

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validates a raw unknown value against the DevexConfig schema.
 * Returns a structured ValidationResult instead of throwing.
 *
 * @param raw - The parsed YAML/JSON object to validate
 */
export function validateConfig(raw: unknown): ValidationResult {
  const result = DevexConfigSchema.safeParse(raw);

  if (result.success) {
    return { valid: true, errors: [] };
  }

  const errors = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));

  return { valid: false, errors };
}

/**
 * Asserts that a raw value is a valid DevexConfig.
 * Throws a formatted error listing all validation failures when invalid.
 *
 * @param raw - The parsed YAML/JSON object to validate
 * @returns Validated and defaulted DevexConfig
 */
export function assertValidConfig(raw: unknown): DevexConfig {
  const result = validateConfig(raw);

  if (result.valid) {
    return DevexConfigSchema.parse(raw);
  }

  const lines = result.errors.map((e) => `  • ${e.path}: ${e.message}`);
  throw new Error(`Invalid devex.yaml:\n${lines.join("\n")}`);
}

/**
 * Validates the workflow framework version ref used in a caller workflow.
 * Governance rejects refs that are not pinned to a semver tag or full SHA.
 */
export function validateWorkflowRef(ref: string): ValidationResult {
  const APPROVED_REF = /^(v\d+\.\d+\.\d+|[0-9a-f]{40})$/;

  if (APPROVED_REF.test(ref)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: [
      {
        path: "workflowVersion.ref",
        message: `Ref "${ref}" is not a pinned semver tag (e.g. v0.1.0) or full 40-char SHA. ` +
          `Using floating refs like "main" or "latest" is prohibited.`,
      },
    ],
  };
}
