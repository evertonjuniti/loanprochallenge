import { describe, it, expect } from "vitest";
import { TypescriptAdapter } from "../src/adapters/typescript-adapter.js";
import { resolveAdapter, supportedLanguages } from "../src/adapters/index.js";
import type { DevexConfig } from "../src/index.js";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const baseConfig: DevexConfig = {
  schemaVersion: 1,
  service: { name: "loan-engine", owner: "lending-platform", type: "microservice" },
  workTracking: {
    workIdPattern: "^[A-Z]+-[0-9]+$",
    branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
    commitPattern: "^\\[[A-Z]+-[0-9]+\\] .+",
    prTitlePattern: "^\\[[A-Z]+-[0-9]+\\] .+",
  },
  runtime: {
    appLanguage: "typescript",
    infraLanguage: "typescript",
    infraFramework: "aws-cdk-typescript",
  },
  local: {},
  ci: {},
  environments: {
    sandbox: { cdkStack: "LoanEngineSandbox", githubEnvironment: "sandbox", awsRegion: "us-east-1" },
  },
  telemetry: { sink: "github-artifact", auditFormat: "ndjson" },
};

// ---------------------------------------------------------------------------
// TypescriptAdapter — setupSteps
// ---------------------------------------------------------------------------

describe("TypescriptAdapter.setupSteps", () => {
  const adapter = new TypescriptAdapter();

  it("returns three steps", () => {
    expect(adapter.setupSteps(baseConfig)).toHaveLength(3);
  });

  it("first step uses actions/setup-node", () => {
    const [step] = adapter.setupSteps(baseConfig);
    expect(step!.uses).toContain("actions/setup-node");
  });

  it("second step enables corepack", () => {
    const steps = adapter.setupSteps(baseConfig);
    expect(steps[1]!.run).toContain("corepack enable");
  });

  it("third step installs dependencies with pnpm install --no-frozen-lockfile", () => {
    const steps = adapter.setupSteps(baseConfig);
    expect(steps[2]!.run).toContain("pnpm install");
    expect(steps[2]!.run).toContain("--no-frozen-lockfile");
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — unitTestSteps
// ---------------------------------------------------------------------------

describe("TypescriptAdapter.unitTestSteps", () => {
  const adapter = new TypescriptAdapter();

  it("falls back to default pnpm test", () => {
    const [step] = adapter.unitTestSteps(baseConfig);
    expect(step!.run).toBe("pnpm test");
  });

  it("uses config.ci.smallTests.unit when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { unit: "pnpm run test:unit --reporter=verbose" } },
    };
    const [step] = adapter.unitTestSteps(config);
    expect(step!.run).toBe("pnpm run test:unit --reporter=verbose");
  });

  it("returns exactly one step", () => {
    expect(adapter.unitTestSteps(baseConfig)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — propertyTestSteps
// ---------------------------------------------------------------------------

describe("TypescriptAdapter.propertyTestSteps", () => {
  const adapter = new TypescriptAdapter();

  it("falls back to default pnpm run test:property", () => {
    const [step] = adapter.propertyTestSteps(baseConfig);
    expect(step!.run).toBe("pnpm run test:property");
  });

  it("uses config.ci.smallTests.property when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { property: "pnpm run test:property --seed=42" } },
    };
    const [step] = adapter.propertyTestSteps(config);
    expect(step!.run).toContain("--seed=42");
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — contractTestSteps
// ---------------------------------------------------------------------------

describe("TypescriptAdapter.contractTestSteps", () => {
  const adapter = new TypescriptAdapter();

  it("falls back to default pnpm run test:contract", () => {
    const [step] = adapter.contractTestSteps(baseConfig);
    expect(step!.run).toBe("pnpm run test:contract");
  });

  it("uses config.ci.smallTests.contract when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { contract: "pnpm run test:contract --bail" } },
    };
    const [step] = adapter.contractTestSteps(config);
    expect(step!.run).toContain("--bail");
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — lintSteps
// ---------------------------------------------------------------------------

describe("TypescriptAdapter.lintSteps", () => {
  const adapter = new TypescriptAdapter();

  it("falls back to default pnpm run lint", () => {
    const [step] = adapter.lintSteps(baseConfig);
    expect(step!.run).toBe("pnpm run lint");
  });

  it("uses config.ci.smallTests.lint when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { lint: "pnpm run lint --max-warnings=0" } },
    };
    const [step] = adapter.lintSteps(config);
    expect(step!.run).toContain("--max-warnings=0");
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — step names
// ---------------------------------------------------------------------------

describe("TypescriptAdapter step names", () => {
  const adapter = new TypescriptAdapter();

  it("all steps have a non-empty name", () => {
    const allSteps = [
      ...adapter.setupSteps(baseConfig),
      ...adapter.unitTestSteps(baseConfig),
      ...adapter.propertyTestSteps(baseConfig),
      ...adapter.contractTestSteps(baseConfig),
      ...adapter.lintSteps(baseConfig),
    ];
    for (const step of allSteps) {
      expect(step.name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveAdapter registry
// ---------------------------------------------------------------------------

describe("resolveAdapter (typescript)", () => {
  it("resolves typescript to TypescriptAdapter", () => {
    const adapter = resolveAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(TypescriptAdapter);
    expect(adapter.name).toBe("typescript");
  });

  it("error message for unsupported language now lists typescript", () => {
    const config: DevexConfig = {
      ...baseConfig,
      runtime: { ...baseConfig.runtime, appLanguage: "go" },
    };
    expect(() => resolveAdapter(config)).toThrow(/typescript/);
  });
});

// ---------------------------------------------------------------------------
// supportedLanguages
// ---------------------------------------------------------------------------

describe("supportedLanguages (after typescript added)", () => {
  it("includes typescript", () => {
    expect(supportedLanguages()).toContain("typescript");
  });

  it("still includes python", () => {
    expect(supportedLanguages()).toContain("python");
  });
});

// ---------------------------------------------------------------------------
// TypescriptAdapter — per-language config (polyglot repos)
// ---------------------------------------------------------------------------

describe("TypescriptAdapter per-language config", () => {
  const adapter = new TypescriptAdapter();

  const polyConfig: DevexConfig = {
    ...baseConfig,
    runtime: { ...baseConfig.runtime, appLanguage: ["typescript", "python"] },
    ci: {
      smallTests: {
        // top-level overrides (would be picked up by single-lang repos)
        unit: "uv run pytest",
        // per-language override for typescript takes precedence
        typescript: { unit: "pnpm vitest run", lint: "pnpm run lint:strict" },
      },
    },
  };

  it("per-language typescript.unit overrides the top-level unit", () => {
    const [step] = adapter.unitTestSteps(polyConfig);
    expect(step!.run).toBe("pnpm vitest run");
  });

  it("per-language typescript.lint overrides the top-level lint", () => {
    const [step] = adapter.lintSteps(polyConfig);
    expect(step!.run).toBe("pnpm run lint:strict");
  });

  it("falls back to top-level override when no per-language key is set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { unit: "pnpm run test:all" } },
    };
    const [step] = adapter.unitTestSteps(config);
    expect(step!.run).toBe("pnpm run test:all");
  });

  it("falls back to adapter default when neither override is set", () => {
    const [step] = adapter.unitTestSteps(baseConfig);
    expect(step!.run).toBe("pnpm test");
  });
});
