import { describe, it, expect } from "vitest";
import {
  DevexConfigSchema,
  WorkTrackingSchema,
  validateConfig,
  assertValidConfig,
  validateWorkflowRef,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// DevexConfig schema
// ---------------------------------------------------------------------------

describe("DevexConfigSchema", () => {
  const minimal = {
    schemaVersion: 1 as const,
    service: { name: "transactionify", owner: "payments-platform" },
    runtime: { appLanguage: "python" as const },
    environments: {
      sandbox: { cdkStack: "TransactionifySandbox", githubEnvironment: "sandbox" },
    },
  };

  it("accepts a minimal valid config and applies defaults", () => {
    const result = DevexConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.schemaVersion).toBe(1);
      expect(result.data.service.type).toBe("microservice");
      expect(result.data.runtime.infraFramework).toBe("aws-cdk-typescript");
      expect(result.data.telemetry.sink).toBe("github-artifact");
    }
  });

  it("rejects a missing required field (environments)", () => {
    const { environments: _omit, ...withoutEnvs } = minimal;
    const result = DevexConfigSchema.safeParse(withoutEnvs);
    expect(result.success).toBe(false);
  });

  it("rejects a service name with uppercase letters", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      service: { ...minimal.service, name: "Transactionify" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown appLanguage", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      runtime: { appLanguage: "cobol" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts appLanguage as an array (polyglot repo)", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      runtime: { appLanguage: ["typescript", "python"] },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown language inside an appLanguage array", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      runtime: { appLanguage: ["typescript", "cobol"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty appLanguage array", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      runtime: { appLanguage: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts per-language smallTests overrides in ci config", () => {
    const result = DevexConfigSchema.safeParse({
      ...minimal,
      runtime: { appLanguage: ["typescript", "python"] },
      ci: {
        smallTests: {
          typescript: { unit: "pnpm vitest run", lint: "pnpm run lint" },
          python: { workingDirectory: "packages/cli", unit: "uv run pytest" },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a full realistic config", () => {
    const full = {
      schemaVersion: 1 as const,
      service: {
        name: "transactionify",
        owner: "payments-platform",
        type: "microservice" as const,
      },
      workTracking: {
        workIdPattern: "^[A-Z]+-[0-9]+$",
        branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
        commitPattern: "^\\[[A-Z]+-[0-9]+\\] .+",
        prTitlePattern: "^\\[[A-Z]+-[0-9]+\\] .+",
      },
      runtime: {
        appLanguage: "python" as const,
        infraLanguage: "typescript" as const,
        infraFramework: "aws-cdk-typescript" as const,
      },
      ci: {
        smallTests: {
          unit: "uv run pytest tests/unit",
          property: "uv run pytest tests/property",
          contract: "uv run pytest tests/contracts",
        },
        cdk: {
          workingDirectory: "infra",
          synthCommand: "pnpm cdk synth",
          deployCommand: "pnpm cdk deploy --require-approval never",
        },
      },
      environments: {
        sandbox: {
          awsRegion: "us-east-1",
          cdkStack: "TransactionifySandbox",
          githubEnvironment: "sandbox",
        },
        staging: {
          awsRegion: "us-east-1",
          cdkStack: "TransactionifyStaging",
          githubEnvironment: "staging",
        },
        production: {
          awsRegion: "us-east-1",
          cdkStack: "TransactionifyProduction",
          githubEnvironment: "production",
        },
      },
      telemetry: { sink: "github-artifact" as const, auditFormat: "ndjson" as const },
      workflowVersion: { ref: "v0.1.0" },
    };

    const result = DevexConfigSchema.safeParse(full);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateConfig / assertValidConfig
// ---------------------------------------------------------------------------

describe("validateConfig", () => {
  it("returns valid:true for a valid config", () => {
    const result = validateConfig({
      schemaVersion: 1,
      service: { name: "my-service", owner: "team" },
      runtime: { appLanguage: "go" },
      environments: {
        production: { cdkStack: "MyStack", githubEnvironment: "production" },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns structured errors for invalid config", () => {
    const result = validateConfig({ schemaVersion: 2 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("assertValidConfig", () => {
  it("throws with field paths when config is invalid", () => {
    expect(() => assertValidConfig({ schemaVersion: 99 })).toThrow(
      /Invalid devex\.yaml/
    );
  });
});

// ---------------------------------------------------------------------------
// validateWorkflowRef
// ---------------------------------------------------------------------------

describe("validateWorkflowRef", () => {
  it("accepts a semver tag", () => {
    expect(validateWorkflowRef("v0.1.0").valid).toBe(true);
    expect(validateWorkflowRef("v1.23.456").valid).toBe(true);
  });

  it("accepts a full 40-char SHA", () => {
    const sha = "a".repeat(40);
    expect(validateWorkflowRef(sha).valid).toBe(true);
  });

  it("rejects 'main'", () => {
    const result = validateWorkflowRef("main");
    expect(result.valid).toBe(false);
    expect(result.errors[0]?.message).toMatch(/pinned semver tag/);
  });

  it("rejects 'latest'", () => {
    expect(validateWorkflowRef("latest").valid).toBe(false);
  });

  it("rejects a short SHA", () => {
    expect(validateWorkflowRef("abc1234").valid).toBe(false);
  });
});
