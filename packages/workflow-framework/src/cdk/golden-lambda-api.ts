import { Construct } from "constructs";
import {
  aws_lambda as lambda,
  aws_apigateway as apigw,
  aws_cloudwatch as cloudwatch,
  aws_logs as logs,
  Duration,
  RemovalPolicy,
} from "aws-cdk-lib";
import { applyGoldenPathTags } from "./tagging.js";

// ---------------------------------------------------------------------------
// GoldenLambdaApi — the Golden Path CDK construct
//
// Wraps the Transactionify-style architecture pattern into a single,
// reusable CDK construct so that every service gets:
//
//   - A Python Lambda function with structured logging.
//   - A REST API Gateway backed by that Lambda.
//   - A dedicated CloudWatch log group (with a configurable retention period).
//   - A P99 duration alarm and an error-rate alarm.
//   - Standard Golden Path tags on every resource.
//
// Usage in a CDK stack:
//
//   const api = new GoldenLambdaApi(this, "TransactionifyApi", {
//     serviceName: "transactionify",
//     handlerPath: path.join(__dirname, "../src"),
//     environmentName: "sandbox",
//     workTrackingTag: "FIN",
//   });
//
//   // access individual resources if needed:
//   api.lambdaFunction.addEnvironment("TABLE_NAME", table.tableName);
//   api.restApi.root.addMethod("GET", ...);
// ---------------------------------------------------------------------------

/** Properties for the GoldenLambdaApi construct. */
export interface GoldenLambdaApiProps {
  /**
   * Service name from devex.yaml.
   * Used in resource names, IDs, and tags.
   */
  serviceName: string;

  /**
   * Absolute path to the Lambda handler source directory.
   * Passed directly to `lambda.Code.fromAsset()`.
   *
   * @example path.join(__dirname, "../src")
   */
  handlerPath: string;

  /**
   * Lambda code source. Defaults to `lambda.Code.fromAsset(handlerPath)`.
   *
   * Override in unit tests with `lambda.Code.fromInline(...)` to avoid
   * triggering CDK's file-system asset staging during test runs:
   *
   * @example
   * // In unit tests:
   * code: lambda.Code.fromInline("def handler(event, context): pass"),
   */
  code?: lambda.Code;

  /**
   * Lambda handler entry point in `<file>.<function>` notation.
   * Defaults to `"handler.handler"`.
   */
  handler?: string;

  /**
   * Python Lambda runtime.
   * Defaults to `lambda.Runtime.PYTHON_3_12`.
   */
  runtime?: lambda.Runtime;

  /**
   * Deployment environment name (e.g. "sandbox", "staging", "production").
   * Used in resource names and tags.
   */
  environmentName: string;

  /**
   * Work ID project prefix (e.g. "FIN" for FIN-123).
   * Added as a `devex:work-prefix` tag on all resources.
   */
  workTrackingTag?: string;

  /**
   * Environment variables injected into the Lambda function.
   * `SERVICE_NAME` and `ENVIRONMENT` are always added automatically.
   */
  environment?: Record<string, string>;

  /**
   * Lambda reserved concurrency limit.
   * Omit to use unreserved concurrency (not recommended for production).
   */
  reservedConcurrency?: number;

  /**
   * Lambda memory in MB. Defaults to 256.
   */
  memorySize?: number;

  /**
   * Lambda execution timeout. Defaults to 30 seconds.
   */
  timeout?: Duration;

  /**
   * CloudWatch log group retention period.
   * Defaults to ONE_WEEK for sandbox/staging, ONE_MONTH for production.
   * Set explicitly to override.
   */
  logRetention?: logs.RetentionDays;

  /**
   * Error rate (%) that triggers the error-rate alarm.
   * Defaults to 1 (%).
   */
  errorRateThresholdPercent?: number;

  /**
   * P99 Lambda duration (ms) that triggers the duration alarm.
   * Defaults to 3000 (3 seconds).
   */
  p99DurationThresholdMs?: number;
}

/**
 * GoldenLambdaApi — Golden Path construct for Python Lambda + REST API services.
 *
 * Provisions a fully observable Python Lambda service backed by Amazon API
 * Gateway, following the Transactionify architecture pattern. Includes
 * structured logging, metric alarms, and standard Golden Path tags.
 *
 * @example
 * // In a CDK stack (e.g. TransactionifySandboxStack):
 * import { GoldenLambdaApi } from "@loanpro/devex-workflow-framework/cdk";
 *
 * const api = new GoldenLambdaApi(this, "TransactionifyApi", {
 *   serviceName:      config.service.name,
 *   handlerPath:      path.join(__dirname, "../src"),
 *   environmentName:  "sandbox",
 *   workTrackingTag:  "FIN",
 *   environment: {
 *     TABLE_NAME: table.tableName,
 *   },
 * });
 */
export class GoldenLambdaApi extends Construct {
  /** The Lambda function powering the API. */
  readonly lambdaFunction: lambda.Function;

  /** The API Gateway REST API. */
  readonly restApi: apigw.RestApi;

  /** The CloudWatch log group for Lambda structured logs. */
  readonly logGroup: logs.LogGroup;

  /** Alarm fires when the error rate exceeds the threshold. */
  readonly errorRateAlarm: cloudwatch.Alarm;

  /** Alarm fires when the p99 duration exceeds the threshold. */
  readonly p99DurationAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: GoldenLambdaApiProps) {
    super(scope, id);

    const {
      serviceName,
      handlerPath,
      handler = "handler.handler",
      runtime = lambda.Runtime.PYTHON_3_12,
      environmentName,
      workTrackingTag,
      environment = {},
      reservedConcurrency,
      memorySize = 256,
      timeout = Duration.seconds(30),
      logRetention = defaultRetention(environmentName),
      errorRateThresholdPercent = 1,
      p99DurationThresholdMs = 3000,
    } = props;

    // Caller may inject a Code object directly (useful in unit tests to avoid
    // CDK's file-system asset staging). Default: bundle from handlerPath.
    const code = props.code ?? lambda.Code.fromAsset(handlerPath);

    const resourcePrefix = `${serviceName}-${environmentName}`;

    // -----------------------------------------------------------------------
    // CloudWatch log group
    //
    // Created explicitly (rather than letting Lambda auto-create it) so we
    // can control the retention period and prevent orphaned log groups after
    // stack deletion.
    // -----------------------------------------------------------------------
    this.logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/lambda/${resourcePrefix}`,
      retention: logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // -----------------------------------------------------------------------
    // Lambda function
    // -----------------------------------------------------------------------
    this.lambdaFunction = new lambda.Function(this, "Handler", {
      functionName: resourcePrefix,
      runtime,
      handler,
      code,
      memorySize,
      timeout,
      ...(reservedConcurrency !== undefined
        ? { reservedConcurrentExecutions: reservedConcurrency }
        : {}),
      logGroup: this.logGroup,
      environment: {
        // Always-present metadata so the Lambda can tag its own logs/events.
        SERVICE_NAME: serviceName,
        ENVIRONMENT: environmentName,
        POWERTOOLS_SERVICE_NAME: serviceName,
        POWERTOOLS_LOG_LEVEL: environmentName === "production" ? "WARNING" : "DEBUG",
        ...environment,
      },
    });

    // -----------------------------------------------------------------------
    // REST API Gateway
    //
    // Wraps the Lambda as a proxy integration — all routes and methods are
    // forwarded to the Lambda, which handles routing internally (e.g. via
    // aws-lambda-powertools Router).
    // -----------------------------------------------------------------------
    this.restApi = new apigw.RestApi(this, "RestApi", {
      restApiName: resourcePrefix,
      description: `Golden Path REST API for ${serviceName} (${environmentName})`,
      deployOptions: {
        stageName: environmentName,
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
        metricsEnabled: true,
      },
      defaultIntegration: new apigw.LambdaIntegration(this.lambdaFunction, {
        proxy: true,
      }),
    });

    // Catch-all proxy resource: ANY /{proxy+} → Lambda
    this.restApi.root.addProxy({
      defaultIntegration: new apigw.LambdaIntegration(this.lambdaFunction, {
        proxy: true,
      }),
      anyMethod: true,
    });

    // -----------------------------------------------------------------------
    // CloudWatch alarms
    // -----------------------------------------------------------------------
    this.errorRateAlarm = new cloudwatch.Alarm(this, "ErrorRateAlarm", {
      alarmName: `${resourcePrefix}-error-rate`,
      alarmDescription:
        `Fires when the ${serviceName} Lambda error rate exceeds ` +
        `${errorRateThresholdPercent}% in ${environmentName}.`,
      metric: this.lambdaFunction.metricErrors({
        period: Duration.minutes(5),
        statistic: "Sum",
      }),
      threshold: errorRateThresholdPercent,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    this.p99DurationAlarm = new cloudwatch.Alarm(this, "P99DurationAlarm", {
      alarmName: `${resourcePrefix}-p99-duration`,
      alarmDescription:
        `Fires when the ${serviceName} Lambda p99 duration exceeds ` +
        `${p99DurationThresholdMs}ms in ${environmentName}.`,
      metric: this.lambdaFunction.metricDuration({
        period: Duration.minutes(5),
        statistic: "p99",
      }),
      threshold: p99DurationThresholdMs,
      evaluationPeriods: 3,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // -----------------------------------------------------------------------
    // Standard tags (applied last so they propagate to all child resources)
    // -----------------------------------------------------------------------
    applyGoldenPathTags(this, { serviceName, environmentName, workTrackingTag });
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function defaultRetention(environmentName: string): logs.RetentionDays {
  if (environmentName === "production" || environmentName === "staging") {
    return logs.RetentionDays.ONE_MONTH;
  }
  return logs.RetentionDays.ONE_WEEK;
}
