"""Pydantic models that mirror the devex.yaml schema defined in the
workflow-framework package (devex-config.schema.ts / devex.schema.json).

These models are the Python-side contract.  Any change to the shared schema
must be reflected here to keep CLI and framework in sync.
"""

from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


# ---------------------------------------------------------------------------
# Work-tracking
# ---------------------------------------------------------------------------


class WorkTrackingConfig(BaseModel):
    workIdPattern: str = "^[A-Z]+-[0-9]+$"
    branchPattern: str = "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$"
    commitPattern: str = r"^\[[A-Z]+-[0-9]+\] .+"
    prTitlePattern: str = r"^\[[A-Z]+-[0-9]+\] .+"


# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------

AppLanguage = Literal["python", "go", "typescript", "clojure", "java", "rust"]
InfraFramework = Literal["aws-cdk-typescript", "terraform", "pulumi", "none"]


class RuntimeConfig(BaseModel):
    appLanguage: AppLanguage
    infraLanguage: Literal["typescript", "python", "go", "hcl", "none"] = "typescript"
    infraFramework: InfraFramework = "aws-cdk-typescript"


# ---------------------------------------------------------------------------
# Local commands
# ---------------------------------------------------------------------------


class LocalCommandsConfig(BaseModel):
    testCommand: Optional[str] = None
    lintCommand: Optional[str] = None
    contractTestCommand: Optional[str] = None
    propertyTestCommand: Optional[str] = None


# ---------------------------------------------------------------------------
# CI configuration
# ---------------------------------------------------------------------------


class SmallTestsConfig(BaseModel):
    unit: Optional[str] = None
    property: Optional[str] = None
    contract: Optional[str] = None
    lint: Optional[str] = None
    typecheck: Optional[str] = None


class CdkConfig(BaseModel):
    workingDirectory: str = "infra"
    synthCommand: str = "pnpm cdk synth"
    diffCommand: str = "pnpm cdk diff"
    deployCommand: str = "pnpm cdk deploy --require-approval never"


class CiConfig(BaseModel):
    smallTests: Optional[SmallTestsConfig] = None
    cdk: Optional[CdkConfig] = None


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------


class EnvironmentConfig(BaseModel):
    awsRegion: str = "us-east-1"
    cdkStack: str
    githubEnvironment: str
    awsAccountId: Optional[str] = None
    roleArn: Optional[str] = None


# ---------------------------------------------------------------------------
# Telemetry
# ---------------------------------------------------------------------------

TelemetrySink = Literal["github-artifact", "cloudwatch", "eventbridge", "s3", "none"]


class TelemetryConfig(BaseModel):
    sink: TelemetrySink = "github-artifact"
    s3Bucket: Optional[str] = None
    cloudwatchLogGroup: Optional[str] = None
    eventBridgeBus: Optional[str] = None
    auditFormat: Literal["ndjson", "json"] = "ndjson"


# ---------------------------------------------------------------------------
# Service metadata
# ---------------------------------------------------------------------------


class ServiceConfig(BaseModel):
    name: str
    owner: str
    type: Literal[
        "microservice", "library", "platform-tool", "data-pipeline", "monolith"
    ] = "microservice"
    repositoryUrl: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_must_be_slug(cls, v: str) -> str:
        if not re.match(r"^[a-z][a-z0-9-]*$", v):
            raise ValueError(
                "Service name must be lowercase alphanumeric with hyphens (e.g. my-service)"
            )
        return v


# ---------------------------------------------------------------------------
# Workflow version pinning
# ---------------------------------------------------------------------------


class WorkflowVersionConfig(BaseModel):
    """Pins the centralized reusable workflow version used by this service."""

    ref: str

    @field_validator("ref")
    @classmethod
    def ref_must_be_pinned(cls, v: str) -> str:
        if not re.match(r"^(v\d+\.\d+\.\d+|[0-9a-f]{40})$", v):
            raise ValueError(
                "Workflow ref must be a semver tag (e.g. v0.1.0) or a full 40-character SHA. "
                "Using 'main' or 'latest' is not allowed."
            )
        return v


# ---------------------------------------------------------------------------
# Root devex.yaml model
# ---------------------------------------------------------------------------


class DevexConfig(BaseModel):
    schemaVersion: Literal[1]
    service: ServiceConfig
    workTracking: WorkTrackingConfig = WorkTrackingConfig()
    runtime: RuntimeConfig
    local: LocalCommandsConfig = LocalCommandsConfig()
    ci: CiConfig = CiConfig()
    environments: dict[str, EnvironmentConfig]
    telemetry: TelemetryConfig = TelemetryConfig()
    workflowVersion: Optional[WorkflowVersionConfig] = None

    @model_validator(mode="after")
    def at_least_one_environment(self) -> "DevexConfig":
        if not self.environments:
            raise ValueError("At least one environment must be defined under 'environments'.")
        return self
