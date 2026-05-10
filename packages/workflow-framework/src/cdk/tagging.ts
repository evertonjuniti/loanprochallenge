import { Tags } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

// ---------------------------------------------------------------------------
// Standard tagging for Golden Path resources
//
// Every resource created by a Golden Path construct receives these tags.
// Tags flow from CDK constructs through CloudFormation to the actual AWS
// resources (Lambda, API Gateway stage, log groups, alarms) so that:
//   1. Cost allocation reports can be filtered by service/environment.
//   2. AWS Resource Explorer queries work across accounts.
//   3. DORA events can reference the same metadata for correlation.
//
// Tagging strategy:
//   devex:service      — service name from devex.yaml (e.g. "transactionify")
//   devex:environment  — deployment environment (e.g. "sandbox")
//   devex:managed-by   — always "devex-workflow-framework" for auditability
//   devex:work-prefix  — Work ID project prefix (e.g. "FIN") when provided
// ---------------------------------------------------------------------------

export interface GoldenPathTags {
  /** Service name from devex.yaml (e.g. "transactionify"). */
  serviceName: string;
  /** Deployment environment (e.g. "sandbox", "staging", "production"). */
  environmentName: string;
  /**
   * Work ID project prefix used by this service (e.g. "FIN" for FIN-123).
   * Omit if the service does not use a fixed project prefix.
   */
  workTrackingTag?: string | undefined;
}

/**
 * Applies the standard Golden Path tags to a CDK construct scope.
 *
 * Call this after all child constructs have been added to the scope so
 * that CDK's tag propagation reaches every resource in the tree.
 *
 * @example
 * applyGoldenPathTags(this, {
 *   serviceName: "transactionify",
 *   environmentName: "production",
 *   workTrackingTag: "FIN",
 * });
 */
export function applyGoldenPathTags(
  scope: IConstruct,
  tags: GoldenPathTags
): void {
  Tags.of(scope).add("devex:service", tags.serviceName);
  Tags.of(scope).add("devex:environment", tags.environmentName);
  Tags.of(scope).add("devex:managed-by", "devex-workflow-framework");

  if (tags.workTrackingTag !== undefined) {
    Tags.of(scope).add("devex:work-prefix", tags.workTrackingTag);
  }
}
