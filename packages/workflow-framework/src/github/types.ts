import type { WorkflowStep } from "../adapters/language-adapter.js";

// ---------------------------------------------------------------------------
// GitHub Actions YAML primitives
//
// Field names use kebab-case to match the GitHub Actions YAML schema exactly.
// All optional fields include `| undefined` so callers can safely assign
// undefined and have the yaml serialiser omit the key automatically.
// ---------------------------------------------------------------------------

/**
 * A single step inside a GitHub Actions job.
 * Serialised directly to YAML — field names are kebab-case.
 */
export interface GithubStep {
  id?: string | undefined;
  name?: string | undefined;
  uses?: string | undefined;
  run?: string | undefined;
  with?: Record<string, string | number | boolean> | undefined;
  env?: Record<string, string> | undefined;
  if?: string | undefined;
  "continue-on-error"?: boolean | undefined;
  "working-directory"?: string | undefined;
}

/**
 * A single job inside a GitHub Actions workflow.
 * Serialised directly to YAML — field names are kebab-case.
 */
export interface GithubJob {
  name?: string | undefined;
  "runs-on": string;
  needs?: string[] | undefined;
  if?: string | undefined;
  environment?: string | undefined;
  permissions?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
  outputs?: Record<string, string> | undefined;
  "timeout-minutes"?: number | undefined;
  steps: GithubStep[];
}

/**
 * A complete GitHub Actions workflow.
 * Serialised directly to YAML — the `on` key is the trigger block.
 */
export interface GithubWorkflow {
  name: string;
  on: Record<string, unknown>;
  permissions?: Record<string, string> | undefined;
  env?: Record<string, string> | undefined;
  jobs: Record<string, GithubJob>;
}

// ---------------------------------------------------------------------------
// Conversion helper
// ---------------------------------------------------------------------------

/**
 * Converts a WorkflowStep (camelCase, from a LanguageAdapter) to a
 * GithubStep (kebab-case, ready for YAML serialisation).
 *
 * This bridges the adapter layer (Phase 2) with the workflow generator
 * (Phase 3) without requiring adapters to know about the YAML format.
 */
export function toGithubStep(step: WorkflowStep): GithubStep {
  const s: GithubStep = {};
  if (step.name !== undefined) s.name = step.name;
  if (step.uses !== undefined) s.uses = step.uses;
  if (step.run !== undefined) s.run = step.run;
  if (step.with !== undefined) s.with = step.with;
  if (step.env !== undefined) s.env = step.env;
  if (step.continueOnError !== undefined) s["continue-on-error"] = step.continueOnError;
  if (step.condition !== undefined) s.if = step.condition;
  if (step.workingDirectory !== undefined) s["working-directory"] = step.workingDirectory;
  return s;
}
