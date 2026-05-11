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
    expect(step!.run).toContain("uv run pytest tests/unit");
  });

  it("uses config.ci.smallTests.unit when set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { unit: "uv run pytest tests/unit -x --tb=short" } },
    };
    const [step] = adapter.unitTestSteps(config);
    expect(step!.run).toContain("uv run pytest tests/unit -x --tb=short");
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
    expect(step!.run).toContain("uv run pytest tests/property");
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
    expect(step!.run).toContain("uv run pytest tests/contracts");
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
    expect(step!.run).toContain("uv run ruff check .");
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

// ---------------------------------------------------------------------------
// PythonAdapter — workingDirectory support
// ---------------------------------------------------------------------------

describe("PythonAdapter workingDirectory", () => {
  const adapter = new PythonAdapter();

  const monoConfig: DevexConfig = {
    ...baseConfig,
    ci: { smallTests: { workingDirectory: "packages/cli" } },
  };

  it("setup install step has workingDirectory when configured", () => {
    const steps = adapter.setupSteps(monoConfig);
    // The first two steps use actions/* — no workingDirectory needed.
    // The third step (run: uv sync) should carry the workingDirectory.
    const installStep = steps.find((s) => s.run?.includes("uv sync"));
    expect(installStep?.workingDirectory).toBe("packages/cli");
  });

  it("unit test step has workingDirectory when configured", () => {
    const [step] = adapter.unitTestSteps(monoConfig);
    expect(step!.workingDirectory).toBe("packages/cli");
  });

  it("property test step has workingDirectory when configured", () => {
    const [step] = adapter.propertyTestSteps(monoConfig);
    expect(step!.workingDirectory).toBe("packages/cli");
  });

  it("contract test step has workingDirectory when configured", () => {
    const [step] = adapter.contractTestSteps(monoConfig);
    expect(step!.workingDirectory).toBe("packages/cli");
  });

  it("lint step has workingDirectory when configured", () => {
    const [step] = adapter.lintSteps(monoConfig);
    expect(step!.workingDirectory).toBe("packages/cli");
  });

  it("workingDirectory is undefined when not configured", () => {
    const [unitStep] = adapter.unitTestSteps(baseConfig);
    expect(unitStep!.workingDirectory).toBeUndefined();
  });

  it("toGithubStep maps workingDirectory to working-directory", async () => {
    const { toGithubStep } = await import("../src/github/types.js");
    const step = { name: "test", run: "uv run pytest", workingDirectory: "packages/cli" };
    const githubStep = toGithubStep(step);
    expect(githubStep["working-directory"]).toBe("packages/cli");
  });
});

// ---------------------------------------------------------------------------
// PythonAdapter — per-language config (polyglot repos)
// ---------------------------------------------------------------------------

describe("PythonAdapter per-language config", () => {
  const adapter = new PythonAdapter();

  const polyConfig: DevexConfig = {
    ...baseConfig,
    runtime: { ...baseConfig.runtime, appLanguage: ["typescript", "python"] },
    ci: {
      smallTests: {
        // top-level overrides
        unit: "pnpm vitest run",
        // per-language override for python takes precedence
        python: {
          workingDirectory: "packages/cli",
          unit: "uv run pytest",
          lint: "uv run ruff check . --select ALL",
        },
      },
    },
  };

  it("per-language python.unit overrides the top-level unit", () => {
    const [step] = adapter.unitTestSteps(polyConfig);
    expect(step!.run).toContain("uv run pytest");
  });

  it("per-language python.lint overrides the top-level lint", () => {
    const [step] = adapter.lintSteps(polyConfig);
    expect(step!.run).toContain("--select ALL");
  });

  it("per-language python.workingDirectory is used for all run steps", () => {
    const [unitStep] = adapter.unitTestSteps(polyConfig);
    expect(unitStep!.workingDirectory).toBe("packages/cli");
    const [lintStep] = adapter.lintSteps(polyConfig);
    expect(lintStep!.workingDirectory).toBe("packages/cli");
  });

  it("falls back to top-level workingDirectory when no per-language key is set", () => {
    const config: DevexConfig = {
      ...baseConfig,
      ci: { smallTests: { workingDirectory: "apps/api" } },
    };
    const [step] = adapter.unitTestSteps(config);
    expect(step!.workingDirectory).toBe("apps/api");
  });
});
