import { describe, it, expect } from "vitest";
import { PythonAdapter } from "../src/adapters/python-adapter.js";
import { resolveAdapter, supportedLanguages } from "../src/adapters/index.js";
import type { DevexConfig } from "../src/index.js";

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const baseConfig: DevexConfig = {
  schemaVersion: 1,
  service: { name: "transactionify", owner: "payments-platform", type: "microservice" },
  workTracking: {
    workIdPattern: "^[A-Z]+-[0-9]+$",
    branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
    commitPattern: "^\\[[A-Z]+-[0-9]+\\] .+",
    prTitlePattern: "^\\[[A-Z]+-[0-9]+\\] .+",
  },
  runtime: {
    appLanguage: "python",
    infraLanguage: "typescript",
    infraFramework: "aws-cdk-typescript",
  },
  local: {},
  ci: {},
  environments: {
    sandbox: { cdkStack: "TransactionifySandbox", githubEnvironment: "sandbox", awsRegion: "us-east-1" },
  },
  telemetry: { sink: "github-artifact", auditFormat: "ndjson" },
};

// ---------------------------------------------------------------------------
// PythonAdapter — setupSteps
// ---------------------------------------------------------------------------

describe("PythonAdapter.setupSteps", () => {
  const adapter = new PythonAdapter();

  it("returns three steps", () => {
    expect(adapter.setupSteps(baseConfig)).toHaveLength(3);
  });

  it("first step uses actions/setup-python", () => {
    const [step] = adapter.setupSteps(baseConfig);
    expect(step!.uses).toContain("actions/setup-python");
  });

  it("second step installs uv", () => {
    const steps = adapter.setupSteps(baseConfig);
    expect(steps[1]!.uses).toContain("astral-sh/setup-uv");
  });

  it("third step installs dependencies with uv sync", () => {
    const steps = adapter.setupSteps(baseConfig);
    expect(steps[2]!.run).toContain("uv sync");
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — unitTestSteps
// ---------------------------------------------------------------------------

describe("PythonAdapter.unitTestSteps", () => {
  const adapter = new PythonAdapter();

  it("falls back to default uv run pytest tests/unit", () => {
    const [step] = adapter.unitTestSteps(baseConfig);
    expect(step!.run).toBe("uv run pytest tests/unit");
  });

  it("uses config.ci.smallTests.unit when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { unit: "uv run pytest tests/unit -x --tb=short" } },
    };
    const [step] = adapter.unitTestSteps(config);
    expect(step!.run).toBe("uv run pytest tests/unit -x --tb=short");
  });

  it("returns exactly one step", () => {
    expect(adapter.unitTestSteps(baseConfig)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — propertyTestSteps
// ---------------------------------------------------------------------------

describe("PythonAdapter.propertyTestSteps", () => {
  const adapter = new PythonAdapter();

  it("falls back to default uv run pytest tests/property", () => {
    const [step] = adapter.propertyTestSteps(baseConfig);
    expect(step!.run).toBe("uv run pytest tests/property");
  });

  it("uses config.ci.smallTests.property when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { property: "uv run pytest tests/property --hypothesis-seed=0" } },
    };
    const [step] = adapter.propertyTestSteps(config);
    expect(step!.run).toContain("hypothesis-seed");
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — contractTestSteps
// ---------------------------------------------------------------------------

describe("PythonAdapter.contractTestSteps", () => {
  const adapter = new PythonAdapter();

  it("falls back to default uv run pytest tests/contracts", () => {
    const [step] = adapter.contractTestSteps(baseConfig);
    expect(step!.run).toBe("uv run pytest tests/contracts");
  });

  it("uses config.ci.smallTests.contract when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { contract: "uv run pytest tests/contracts -v" } },
    };
    const [step] = adapter.contractTestSteps(config);
    expect(step!.run).toContain("-v");
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — lintSteps
// ---------------------------------------------------------------------------

describe("PythonAdapter.lintSteps", () => {
  const adapter = new PythonAdapter();

  it("falls back to default uv run ruff check .", () => {
    const [step] = adapter.lintSteps(baseConfig);
    expect(step!.run).toBe("uv run ruff check .");
  });

  it("uses config.ci.smallTests.lint when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { lint: "uv run ruff check . --select ALL" } },
    };
    const [step] = adapter.lintSteps(config);
    expect(step!.run).toContain("--select ALL");
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — step names
// ---------------------------------------------------------------------------

describe("PythonAdapter step names", () => {
  const adapter = new PythonAdapter();

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

describe("resolveAdapter", () => {
  it("resolves python to PythonAdapter", () => {
    const adapter = resolveAdapter(baseConfig);
    expect(adapter).toBeInstanceOf(PythonAdapter);
    expect(adapter.name).toBe("python");
  });

  it("throws a descriptive error for an unsupported language", () => {
    const config: DevexConfig = {
      ...baseConfig,
      runtime: { ...baseConfig.runtime, appLanguage: "go" },
    };
    expect(() => resolveAdapter(config)).toThrow(/No language adapter registered for "go"/);
    expect(() => resolveAdapter(config)).toThrow(/python/); // lists supported languages
  });
});

// ---------------------------------------------------------------------------
// supportedLanguages
// ---------------------------------------------------------------------------

describe("supportedLanguages", () => {
  it("includes python", () => {
    expect(supportedLanguages()).toContain("python");
  });
});
