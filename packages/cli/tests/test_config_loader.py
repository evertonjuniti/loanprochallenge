"""Unit tests for the config loader."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from devex_cli.config.loader import DevexConfigError, load_config


MINIMAL_VALID = {
    "schemaVersion": 1,
    "service": {"name": "my-service", "owner": "platform-team"},
    "runtime": {"appLanguage": "python"},
    "environments": {
        "sandbox": {"cdkStack": "MySandbox", "githubEnvironment": "sandbox"}
    },
}


def _write(tmp_path: Path, data: dict) -> Path:
    p = tmp_path / "devex.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


class TestLoadConfig:
    def test_loads_minimal_valid_config(self, tmp_path: Path):
        path = _write(tmp_path, MINIMAL_VALID)
        cfg = load_config(path)
        assert cfg.service.name == "my-service"
        assert cfg.runtime.appLanguage == "python"

    def test_applies_schema_defaults(self, tmp_path: Path):
        path = _write(tmp_path, MINIMAL_VALID)
        cfg = load_config(path)
        assert cfg.runtime.infraFramework == "aws-cdk-typescript"
        assert cfg.telemetry.sink == "github-artifact"

    def test_raises_when_file_missing(self, tmp_path: Path):
        with pytest.raises(DevexConfigError, match="not found"):
            load_config(tmp_path / "devex.yaml")

    def test_raises_on_invalid_yaml(self, tmp_path: Path):
        p = tmp_path / "devex.yaml"
        p.write_text("key: [unclosed", encoding="utf-8")
        with pytest.raises(DevexConfigError, match="not valid YAML"):
            load_config(p)

    def test_raises_when_schema_version_missing(self, tmp_path: Path):
        bad = {**MINIMAL_VALID}
        del bad["schemaVersion"]
        path = _write(tmp_path, bad)
        with pytest.raises(DevexConfigError):
            load_config(path)

    def test_raises_when_no_environments(self, tmp_path: Path):
        bad = {**MINIMAL_VALID, "environments": {}}
        path = _write(tmp_path, bad)
        with pytest.raises(DevexConfigError):
            load_config(path)

    def test_raises_on_invalid_service_name(self, tmp_path: Path):
        bad = {**MINIMAL_VALID, "service": {"name": "My Service", "owner": "team"}}
        path = _write(tmp_path, bad)
        with pytest.raises(DevexConfigError):
            load_config(path)

    def test_raises_on_unpinned_workflow_ref(self, tmp_path: Path):
        data = {**MINIMAL_VALID, "workflowVersion": {"ref": "main"}}
        path = _write(tmp_path, data)
        with pytest.raises(DevexConfigError):
            load_config(path)

    def test_accepts_pinned_semver_ref(self, tmp_path: Path):
        data = {**MINIMAL_VALID, "workflowVersion": {"ref": "v0.1.0"}}
        path = _write(tmp_path, data)
        cfg = load_config(path)
        assert cfg.workflowVersion is not None
        assert cfg.workflowVersion.ref == "v0.1.0"
