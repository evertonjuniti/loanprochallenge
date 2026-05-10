import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { aws_lambda as lambda } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { GoldenLambdaApi } from "../src/index.js";

// ---------------------------------------------------------------------------
// Helper: create a fresh CDK App + Stack + GoldenLambdaApi for each test
// ---------------------------------------------------------------------------

// Use Code.fromInline so CDK never touches the file system during tests.
// Code.fromAsset() copies the directory to a temp location and fingerprints
// it — when 35 tests each create a fresh App concurrently, this causes EBUSY
// and ENOENT race conditions on Windows.
const INLINE_CODE = lambda.Code.fromInline(
  "def handler(event, context): return {'statusCode': 200}"
);

function buildStack(overrides: Partial<ConstructorParameters<typeof GoldenLambdaApi>[2]> = {}) {
  const app = new App();
  const stack = new Stack(app, "TestStack");

  const api = new GoldenLambdaApi(stack, "TestApi", {
    serviceName: "transactionify",
    handlerPath: "/unused-in-tests",   // irrelevant: `code` overrides fromAsset
    code: INLINE_CODE,
    environmentName: "sandbox",
    workTrackingTag: "FIN",
    ...overrides,
  });

  const template = Template.fromStack(stack);
  return { stack, api, template };
}

// ---------------------------------------------------------------------------
// Lambda function
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — Lambda function", () => {
  it("creates exactly one Lambda function", () => {
    const { template } = buildStack();
    template.resourceCountIs("AWS::Lambda::Function", 1);
  });

  it("uses Python 3.12 runtime by default", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "python3.12",
    });
  });

  it("defaults to handler.handler", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "handler.handler",
    });
  });

  it("uses the provided handler override", () => {
    const { template } = buildStack({ handler: "app.main" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "app.main",
    });
  });

  it("sets memorySize to 256 by default", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 256,
    });
  });

  it("respects a custom memorySize", () => {
    const { template } = buildStack({ memorySize: 1024 });
    template.hasResourceProperties("AWS::Lambda::Function", {
      MemorySize: 1024,
    });
  });

  it("injects SERVICE_NAME and ENVIRONMENT into the function environment", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          SERVICE_NAME: "transactionify",
          ENVIRONMENT: "sandbox",
        }),
      },
    });
  });

  it("merges caller-supplied environment variables", () => {
    const { template } = buildStack({ environment: { TABLE_NAME: "my-table" } });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({
          TABLE_NAME: "my-table",
          SERVICE_NAME: "transactionify",
        }),
      },
    });
  });

  it("sets POWERTOOLS_LOG_LEVEL to DEBUG for sandbox", () => {
    const { template } = buildStack({ environmentName: "sandbox" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ POWERTOOLS_LOG_LEVEL: "DEBUG" }),
      },
    });
  });

  it("sets POWERTOOLS_LOG_LEVEL to WARNING for production", () => {
    const { template } = buildStack({ environmentName: "production" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ POWERTOOLS_LOG_LEVEL: "WARNING" }),
      },
    });
  });

  it("does not set reservedConcurrentExecutions when not provided", () => {
    const { template } = buildStack();
    // The Lambda resource should exist but without ReservedConcurrentExecutions
    const resources = template.findResources("AWS::Lambda::Function");
    const lambdaProps = Object.values(resources)[0]?.Properties as Record<string, unknown> | undefined;
    expect(lambdaProps?.["ReservedConcurrentExecutions"]).toBeUndefined();
  });

  it("sets reservedConcurrentExecutions when provided", () => {
    const { template } = buildStack({ reservedConcurrency: 10 });
    template.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 10,
    });
  });
});

// ---------------------------------------------------------------------------
// CloudWatch log group
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — log group", () => {
  it("creates a dedicated CloudWatch log group", () => {
    const { template } = buildStack();
    template.resourceCountIs("AWS::Logs::LogGroup", 1);
  });

  it("names the log group /aws/lambda/<service>-<environment>", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      LogGroupName: "/aws/lambda/transactionify-sandbox",
    });
  });

  it("uses ONE_WEEK retention for sandbox", () => {
    const { template } = buildStack({ environmentName: "sandbox" });
    // 7 days = RetentionDays.ONE_WEEK
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 7,
    });
  });

  it("uses ONE_MONTH retention for production", () => {
    const { template } = buildStack({ environmentName: "production" });
    // 30 days = RetentionDays.ONE_MONTH
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
  });

  it("uses ONE_MONTH retention for staging", () => {
    const { template } = buildStack({ environmentName: "staging" });
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    });
  });
});

// ---------------------------------------------------------------------------
// API Gateway
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — REST API", () => {
  it("creates a REST API", () => {
    const { template } = buildStack();
    template.resourceCountIs("AWS::ApiGateway::RestApi", 1);
  });

  it("names the REST API <service>-<environment>", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::ApiGateway::RestApi", {
      Name: "transactionify-sandbox",
    });
  });

  it("creates Lambda permissions for the API Gateway integration", () => {
    const { template } = buildStack();
    // API Gateway creates multiple Lambda::Permission resources (root + proxy routes)
    const permissions = template.findResources("AWS::Lambda::Permission");
    expect(Object.keys(permissions).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// CloudWatch alarms
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — CloudWatch alarms", () => {
  it("creates exactly two alarms (error-rate + p99-duration)", () => {
    const { template } = buildStack();
    template.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  });

  it("creates an error-rate alarm with the default 1% threshold", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "transactionify-sandbox-error-rate",
      Threshold: 1,
      EvaluationPeriods: 3,
    });
  });

  it("creates a p99-duration alarm with the default 3000ms threshold", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "transactionify-sandbox-p99-duration",
      Threshold: 3000,
      EvaluationPeriods: 3,
    });
  });

  it("respects custom error-rate threshold", () => {
    const { template } = buildStack({ errorRateThresholdPercent: 5 });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "transactionify-sandbox-error-rate",
      Threshold: 5,
    });
  });

  it("respects custom p99 duration threshold", () => {
    const { template } = buildStack({ p99DurationThresholdMs: 1000 });
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "transactionify-sandbox-p99-duration",
      Threshold: 1000,
    });
  });
});

// ---------------------------------------------------------------------------
// Golden Path tags
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — Golden Path tags", () => {
  it("tags the Lambda function with devex:service", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: "devex:service", Value: "transactionify" }),
      ]),
    });
  });

  it("tags the Lambda function with devex:environment", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: "devex:environment", Value: "sandbox" }),
      ]),
    });
  });

  it("tags the Lambda function with devex:managed-by", () => {
    const { template } = buildStack();
    template.hasResourceProperties("AWS::Lambda::Function", {
      Tags: Match.arrayWith([
        Match.objectLike({
          Key: "devex:managed-by",
          Value: "devex-workflow-framework",
        }),
      ]),
    });
  });

  it("tags the Lambda with devex:work-prefix when workTrackingTag is provided", () => {
    const { template } = buildStack({ workTrackingTag: "FIN" });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: "devex:work-prefix", Value: "FIN" }),
      ]),
    });
  });

  it("omits devex:work-prefix when workTrackingTag is not provided", () => {
    const { template } = buildStack({ workTrackingTag: undefined });
    const resources = template.findResources("AWS::Lambda::Function");
    const props = Object.values(resources)[0]?.Properties as Record<string, unknown> | undefined;
    const tags = (props?.["Tags"] ?? []) as Array<{ Key: string; Value: string }>;
    const workPrefixTag = tags.find((t) => t.Key === "devex:work-prefix");
    expect(workPrefixTag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Construct shape (exposed properties)
// ---------------------------------------------------------------------------

describe("GoldenLambdaApi — construct surface", () => {
  it("exposes lambdaFunction", () => {
    const { api } = buildStack();
    expect(api.lambdaFunction).toBeDefined();
  });

  it("exposes restApi", () => {
    const { api } = buildStack();
    expect(api.restApi).toBeDefined();
  });

  it("exposes logGroup", () => {
    const { api } = buildStack();
    expect(api.logGroup).toBeDefined();
  });

  it("exposes errorRateAlarm", () => {
    const { api } = buildStack();
    expect(api.errorRateAlarm).toBeDefined();
  });

  it("exposes p99DurationAlarm", () => {
    const { api } = buildStack();
    expect(api.p99DurationAlarm).toBeDefined();
  });
});
