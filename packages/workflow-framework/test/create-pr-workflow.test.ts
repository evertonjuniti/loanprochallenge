import { describe, it, expect } from "vitest";
import {
  createPrWorkflow,
  renderWorkflowYaml,
  buildGovernanceJob,
  buildSmallTestsJob,
  buildCdkSynthJob,
  buildDeployJob,
  buildDoraAuditJob,
  toGithubStep,
} from "../src/index.js";
import type { DevexConfig } from "../src/index.js";

// ---------------------------------------------------------------------------
// Shared test fixture
// ---------------------------------------------------------------------------

/** Minimal three-environment config that mirrors the Transactionify pattern. */
const TRANSACTIONIFY: DevexConfig = {
  schemaVersion: 1,
  service: {
    name: "transactionify",
    owner: "payments-platform",
    type: "microservice",
  },
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
  ci: {
    cdk: {
      workingDirectory: "infra",
      synthCommand: "pnpm cdk synth",
      diffCommand: "pnpm cdk diff",
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
  telemetry: {
    sink: "github-artifact",
    auditFormat: "ndjson",
  },
};

/** Config without CDK (pure TypeScript service). */
const NO_CDK_CONFIG: DevexConfig = {
  schemaVersion: 1,
  service: { name: "my-lib", owner: "platform-team", type: "library" },
  workTracking: {
    workIdPattern: "^[A-Z]+-[0-9]+$",
    branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
    commitPattern: "^\\[[A-Z]+-[0-9]+\\] .+",
    prTitlePattern: "^\\[[A-Z]+-[0-9]+\\] .+",
  },
  runtime: {
    appLanguage: "typescript",
    infraLanguage: "none",
    infraFramework: "none",
  },
  local: {},
  ci: {},
  environments: {
    production: {
      awsRegion: "us-east-1",
      cdkStack: "MyLibProduction",
      githubEnvironment: "production",
    },
  },
  telemetry: { sink: "github-artifact", auditFormat: "ndjson" },
};

// ---------------------------------------------------------------------------
// createPrWorkflow — structure
// ---------------------------------------------------------------------------

describe("createPrWorkflow", () => {
  it("returns a GithubWorkflow object with the required top-level fields", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);

    expect(wf.name).toBe("PR Pipeline");
    expect(wf.on).toHaveProperty("pull_request");
    expect(wf.permissions).toMatchObject({
      contents: "read",
      "pull-requests": "write",
      checks: "write",
      "id-token": "write",
    });
  });

  it("includes all five required job types for a CDK service", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    const jobIds = Object.keys(wf.jobs);

    expect(jobIds).toContain("governance");
    expect(jobIds).toContain("small-tests");
    expect(jobIds).toContain("cdk-synth");
    expect(jobIds).toContain("dora-audit");
  });

  it("creates one deploy job per environment", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    const jobIds = Object.keys(wf.jobs);

    expect(jobIds).toContain("deploy-sandbox");
    expect(jobIds).toContain("deploy-staging");
    expect(jobIds).toContain("deploy-production");
  });

  it("omits cdk-synth when infraFramework is not aws-cdk-typescript", () => {
    const wf = createPrWorkflow(NO_CDK_CONFIG);
    expect(Object.keys(wf.jobs)).not.toContain("cdk-synth");
  });

  it("pull_request trigger includes expected event types", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    const pr = wf.on["pull_request"] as { types: string[] };
    expect(pr.types).toContain("opened");
    expect(pr.types).toContain("synchronize");
    expect(pr.types).toContain("ready_for_review");
  });
});

// ---------------------------------------------------------------------------
// createPrWorkflow — job dependency chain
// ---------------------------------------------------------------------------

describe("createPrWorkflow job dependency chain", () => {
  it("governance job has no needs dependency", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["governance"]?.needs).toBeUndefined();
  });

  it("small-tests needs governance", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["small-tests"]?.needs).toEqual(["governance"]);
  });

  it("cdk-synth needs small-tests", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["cdk-synth"]?.needs).toEqual(["small-tests"]);
  });

  it("first deploy job needs cdk-synth (when CDK is configured)", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["deploy-sandbox"]?.needs).toEqual(["cdk-synth"]);
  });

  it("second deploy job needs the first deploy job (sequential chaining)", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["deploy-staging"]?.needs).toEqual(["deploy-sandbox"]);
  });

  it("third deploy job needs the second deploy job", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["deploy-production"]?.needs).toEqual(["deploy-staging"]);
  });

  it("dora-audit needs only the last deploy job (production, not all envs)", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    // Only the last deploy job is needed — the sequential chain already
    // implies sandbox → staging ran before production.
    expect(wf.jobs["dora-audit"]?.needs).toEqual(["deploy-production"]);
  });

  it("without CDK: first deploy job needs small-tests directly", () => {
    const wf = createPrWorkflow(NO_CDK_CONFIG);
    expect(wf.jobs["deploy-production"]?.needs).toEqual(["small-tests"]);
  });

  it("dora-audit always runs (if: always())", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    expect(wf.jobs["dora-audit"]?.if).toBe("always()");
  });
});

// ---------------------------------------------------------------------------
// buildGovernanceJob
// ---------------------------------------------------------------------------

describe("buildGovernanceJob", () => {
  it("returns a job named 'Governance' on ubuntu-latest by default", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    expect(job.name).toBe("Governance");
    expect(job["runs-on"]).toBe("ubuntu-latest");
  });

  it("respects a custom runsOn value", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY, { runsOn: "self-hosted" });
    expect(job["runs-on"]).toBe("self-hosted");
  });

  it("includes checkout with full git history", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const checkout = job.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout).toBeDefined();
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
  });

  it("includes a step that validates the branch name", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const step = job.steps.find((s) => s.id === "validate-branch");
    expect(step).toBeDefined();
    expect(step?.env?.["BRANCH_NAME"]).toContain("github.head_ref");
  });

  it("includes a step that validates PR title", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const step = job.steps.find((s) => s.id === "validate-pr-title");
    expect(step).toBeDefined();
    expect(step?.env?.["PR_TITLE"]).toContain("pull_request.title");
  });

  it("includes a step that validates commit messages", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const step = job.steps.find((s) => s.id === "validate-commits");
    expect(step).toBeDefined();
    expect(step?.env?.["BASE_SHA"]).toContain("pull_request.base.sha");
  });

  it("adds a workflow-ref validation step when workflowVersion is set", () => {
    const config: DevexConfig = {
      ...TRANSACTIONIFY,
      workflowVersion: { ref: "v0.1.0" },
    };
    const job = buildGovernanceJob(config);
    const step = job.steps.find((s) => s.id === "validate-workflow-ref");
    expect(step).toBeDefined();
    expect(step?.env?.["WORKFLOW_REF"]).toBe("v0.1.0");
  });

  it("omits workflow-ref step when workflowVersion is absent", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const step = job.steps.find((s) => s.id === "validate-workflow-ref");
    expect(step).toBeUndefined();
  });

  it("step run scripts use node --input-type=module and inline validation logic", () => {
    const job = buildGovernanceJob(TRANSACTIONIFY);
    const branchStep = job.steps.find((s) => s.id === "validate-branch");
    expect(branchStep?.run).toContain("node --input-type=module");
    expect(branchStep?.run).not.toContain("@loanpro/devex-workflow-framework");
  });
});

// ---------------------------------------------------------------------------
// buildSmallTestsJob
// ---------------------------------------------------------------------------

describe("buildSmallTestsJob", () => {
  it("returns a job named 'Small Tests'", () => {
    const job = buildSmallTestsJob(TRANSACTIONIFY);
    expect(job.name).toBe("Small Tests");
  });

  it("sets the needs dependency when provided", () => {
    const job = buildSmallTestsJob(TRANSACTIONIFY, { needs: ["governance"] });
    expect(job.needs).toEqual(["governance"]);
  });

  it("includes adapter setup steps (Python adapter for transactionify)", () => {
    const job = buildSmallTestsJob(TRANSACTIONIFY);
    const setupPython = job.steps.find((s) => s.uses?.includes("setup-python"));
    expect(setupPython).toBeDefined();
  });

  it("includes unit test step", () => {
    const job = buildSmallTestsJob(TRANSACTIONIFY);
    const unitStep = job.steps.find(
      (s) => s.name === "Run unit tests" || s.run?.includes("pytest")
    );
    expect(unitStep).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// buildCdkSynthJob
// ---------------------------------------------------------------------------

describe("buildCdkSynthJob", () => {
  it("returns a job named 'CDK Synth'", () => {
    const job = buildCdkSynthJob(TRANSACTIONIFY);
    expect(job.name).toBe("CDK Synth");
  });

  it("uses the working directory from config", () => {
    const job = buildCdkSynthJob(TRANSACTIONIFY);
    const synthStep = job.steps.find((s) => s.name === "CDK synth");
    expect(synthStep?.["working-directory"]).toBe("infra");
  });

  it("uses the synth command from config", () => {
    const job = buildCdkSynthJob(TRANSACTIONIFY);
    const synthStep = job.steps.find((s) => s.name === "CDK synth");
    expect(synthStep?.run).toBe("pnpm cdk synth");
  });

  it("defaults to 'infra' working directory when not configured", () => {
    const config: DevexConfig = { ...TRANSACTIONIFY, ci: {} };
    const job = buildCdkSynthJob(config);
    const synthStep = job.steps.find((s) => s.name === "CDK synth");
    expect(synthStep?.["working-directory"]).toBe("infra");
  });
});

// ---------------------------------------------------------------------------
// buildDeployJob
// ---------------------------------------------------------------------------

describe("buildDeployJob", () => {
  const envConfig = TRANSACTIONIFY.environments["sandbox"]!;

  it("returns a job named 'Deploy (sandbox)'", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    expect(job.name).toBe("Deploy (sandbox)");
  });

  it("sets the GitHub environment", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    expect(job.environment).toBe("sandbox");
  });

  it("includes AWS credentials configuration step", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    const credStep = job.steps.find((s) =>
      s.uses?.includes("configure-aws-credentials")
    );
    expect(credStep).toBeDefined();
    expect(credStep?.with?.["aws-region"]).toBe("us-east-1");
  });

  it("deploys the correct CDK stack", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    const deployStep = job.steps.find((s) => s.id === "cdk-deploy");
    expect(deployStep?.run).toContain("TransactionifySandbox");
  });

  it("includes audit event emission step (always runs)", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    const auditStep = job.steps.find((s) => s.name === "Emit deployment audit event");
    expect(auditStep).toBeDefined();
    expect(auditStep?.if).toBe("always()");
  });

  it("includes artifact upload step for DORA events", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    const uploadStep = job.steps.find((s) => s.name === "Upload audit events");
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.with?.["name"]).toBe("audit-events-sandbox");
  });

  it("uses a direct roleArn from config when provided", () => {
    const envWithRole = {
      ...envConfig,
      roleArn: "arn:aws:iam::123456789012:role/MyRole",
    };
    const job = buildDeployJob("sandbox", envWithRole, TRANSACTIONIFY);
    const credStep = job.steps.find((s) =>
      s.uses?.includes("configure-aws-credentials")
    );
    expect(credStep?.with?.["role-to-assume"]).toBe(
      "arn:aws:iam::123456789012:role/MyRole"
    );
  });

  it("falls back to a secret-based role ARN when roleArn is absent", () => {
    const job = buildDeployJob("sandbox", envConfig, TRANSACTIONIFY);
    const credStep = job.steps.find((s) =>
      s.uses?.includes("configure-aws-credentials")
    );
    expect(credStep?.with?.["role-to-assume"]).toContain("AWS_DEPLOY_ROLE_ARN_SANDBOX");
  });
});

// ---------------------------------------------------------------------------
// buildDoraAuditJob
// ---------------------------------------------------------------------------

describe("buildDoraAuditJob", () => {
  it("returns a job named 'DORA & Audit'", () => {
    const job = buildDoraAuditJob(TRANSACTIONIFY);
    expect(job.name).toBe("DORA & Audit");
  });

  it("always runs even when upstream jobs fail", () => {
    const job = buildDoraAuditJob(TRANSACTIONIFY);
    expect(job.if).toBe("always()");
  });

  it("downloads artifacts from all deploy jobs", () => {
    const job = buildDoraAuditJob(TRANSACTIONIFY);
    const downloadStep = job.steps.find((s) =>
      s.uses?.startsWith("actions/download-artifact")
    );
    expect(downloadStep).toBeDefined();
    expect(downloadStep?.with?.["pattern"]).toBe("audit-events-*");
  });

  it("includes a DORA compute step using node --input-type=module with inlined logic", () => {
    const job = buildDoraAuditJob(TRANSACTIONIFY);
    const computeStep = job.steps.find(
      (s) => s.name === "Compute DORA metrics and write step summary"
    );
    expect(computeStep).toBeDefined();
    expect(computeStep?.run).toContain("node --input-type=module");
    expect(computeStep?.run).toContain("DORA Metrics Summary");
    expect(computeStep?.run).not.toContain("@loanpro/devex-workflow-framework");
  });

  it("uploads a consolidated dora-events artifact", () => {
    const job = buildDoraAuditJob(TRANSACTIONIFY);
    const uploadStep = job.steps.find(
      (s) => s.uses?.startsWith("actions/upload-artifact") && s.name?.includes("consolidated")
    );
    expect(uploadStep).toBeDefined();
    expect(uploadStep?.with?.["name"]).toBe("dora-events");
  });
});

// ---------------------------------------------------------------------------
// renderWorkflowYaml
// ---------------------------------------------------------------------------

describe("renderWorkflowYaml", () => {
  it("returns a non-empty string", () => {
    const wf = createPrWorkflow(TRANSACTIONIFY);
    const yaml = renderWorkflowYaml(wf);
    expect(typeof yaml).toBe("string");
    expect(yaml.length).toBeGreaterThan(100);
  });

  it("contains the machine-generated header", () => {
    const yaml = renderWorkflowYaml(createPrWorkflow(TRANSACTIONIFY));
    expect(yaml).toContain("generated by @loanpro/devex-workflow-framework");
  });

  it("includes all required job IDs in the YAML output", () => {
    const yaml = renderWorkflowYaml(createPrWorkflow(TRANSACTIONIFY));
    expect(yaml).toContain("governance:");
    expect(yaml).toContain("small-tests:");
    expect(yaml).toContain("cdk-synth:");
    expect(yaml).toContain("deploy-sandbox:");
    expect(yaml).toContain("deploy-staging:");
    expect(yaml).toContain("deploy-production:");
    expect(yaml).toContain("dora-audit:");
  });

  it("includes the workflow schema modeline", () => {
    const yaml = renderWorkflowYaml(createPrWorkflow(TRANSACTIONIFY));
    expect(yaml).toContain("schemastore.org/github-workflow.json");
  });
});

// ---------------------------------------------------------------------------
// toGithubStep
// ---------------------------------------------------------------------------

describe("toGithubStep", () => {
  it("maps run + name correctly", () => {
    const step = toGithubStep({ name: "Run tests", run: "pnpm test" });
    expect(step.name).toBe("Run tests");
    expect(step.run).toBe("pnpm test");
  });

  it("maps uses + with correctly", () => {
    const step = toGithubStep({
      name: "Setup",
      uses: "actions/setup-python@v5",
      with: { "python-version": "3.12" },
    });
    expect(step.uses).toBe("actions/setup-python@v5");
    expect(step.with?.["python-version"]).toBe("3.12");
  });

  it("maps continueOnError → continue-on-error", () => {
    const step = toGithubStep({ name: "Maybe fail", run: "exit 1", continueOnError: true });
    expect(step["continue-on-error"]).toBe(true);
  });

  it("maps condition → if", () => {
    const step = toGithubStep({ name: "Conditional", run: "echo hi", condition: "always()" });
    expect(step.if).toBe("always()");
  });

  it("omits undefined fields from the result", () => {
    const step = toGithubStep({ name: "Simple", run: "echo hi" });
    expect("uses" in step).toBe(false);
    expect("if" in step).toBe(false);
    expect("continue-on-error" in step).toBe(false);
  });
});
