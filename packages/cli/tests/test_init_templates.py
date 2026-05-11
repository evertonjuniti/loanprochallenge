"""Tests for `devex init` — template rendering and file generation."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from devex_cli.main import app

runner = CliRunner()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_init(tmp_path: Path, **kwargs) -> tuple:
    """Run `devex init` inside a fake Git repo at tmp_path."""
    # Create a minimal .git directory so Git hooks can be written
    (tmp_path / ".git" / "hooks").mkdir(parents=True, exist_ok=True)
    args = [
        "init",
        "--service", kwargs.get("service", "my-service"),
        "--owner", kwargs.get("owner", "platform-team"),
        "--app-language", kwargs.get("app_language", "python"),
        "--infra", kwargs.get("infra", "aws-cdk-typescript"),
        "--workflow-ref", kwargs.get("workflow_ref", "v0.1.0"),
        "--root", str(tmp_path),   # bypass git root detection
        "--skip-check",            # avoid running devex check (no real commits)
    ]
    result = runner.invoke(app, args, catch_exceptions=False)
    return result, tmp_path


# ---------------------------------------------------------------------------
# devex.yaml generation
# ---------------------------------------------------------------------------


class TestInitDevexYaml:
    def test_creates_devex_yaml(self, tmp_path: Path):
        result, root = _run_init(tmp_path)
        assert result.exit_code == 0, result.output
        assert (root / "devex.yaml").exists()

    def test_devex_yaml_has_correct_service_name(self, tmp_path: Path):
        _run_init(tmp_path, service="transactionify")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert cfg["service"]["name"] == "transactionify"

    def test_devex_yaml_has_correct_app_language(self, tmp_path: Path):
        _run_init(tmp_path, app_language="python")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert cfg["runtime"]["appLanguage"] == "python"

    @pytest.mark.parametrize("language", ["python", "typescript", "go"])
    def test_devex_yaml_language_drives_ci_commands(self, tmp_path: Path, language: str):
        """Each language should produce distinct, non-empty CI commands."""
        _run_init(tmp_path, app_language=language)
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        small = cfg["ci"]["smallTests"]
        assert small["unit"], f"{language}: ci.smallTests.unit must not be empty"
        assert small["lint"], f"{language}: ci.smallTests.lint must not be empty"

    def test_python_ci_commands_use_uv(self, tmp_path: Path):
        _run_init(tmp_path, app_language="python")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert "uv" in cfg["ci"]["smallTests"]["unit"]
        assert "uv" in cfg["ci"]["smallTests"]["lint"]
        assert "uv" in cfg["local"]["testCommand"]

    def test_typescript_ci_commands_use_pnpm(self, tmp_path: Path):
        _run_init(tmp_path, app_language="typescript")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert "pnpm" in cfg["ci"]["smallTests"]["unit"]
        assert "pnpm" in cfg["ci"]["smallTests"]["lint"]

    def test_workflow_ref_is_written(self, tmp_path: Path):
        _run_init(tmp_path, workflow_ref="v0.2.4")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert cfg["workflowVersion"]["ref"] == "v0.2.4"

    def test_environments_are_generated(self, tmp_path: Path):
        _run_init(tmp_path, service="my-svc")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        envs = cfg["environments"]
        assert "sandbox" in envs
        assert "staging" in envs
        assert "production" in envs

    def test_cdk_stack_names_use_pascal_case(self, tmp_path: Path):
        _run_init(tmp_path, service="my-service")
        cfg = yaml.safe_load((tmp_path / "devex.yaml").read_text())
        assert cfg["environments"]["sandbox"]["cdkStack"] == "MyServiceSandbox"


# ---------------------------------------------------------------------------
# Caller workflow
# ---------------------------------------------------------------------------


class TestInitCallerWorkflow:
    def test_creates_devex_pr_yml(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".github" / "workflows" / "devex-pr.yml").exists()

    def test_workflow_uses_correct_ref(self, tmp_path: Path):
        _run_init(tmp_path, workflow_ref="v0.3.0")
        content = (tmp_path / ".github" / "workflows" / "devex-pr.yml").read_text()
        assert "@v0.3.0" in content

    def test_workflow_passes_config_path(self, tmp_path: Path):
        _run_init(tmp_path)
        content = (tmp_path / ".github" / "workflows" / "devex-pr.yml").read_text()
        assert "config-path: devex.yaml" in content


# ---------------------------------------------------------------------------
# PR template
# ---------------------------------------------------------------------------


class TestInitPrTemplate:
    def test_creates_pr_template(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".github" / "pull_request_template.md").exists()

    def test_pr_template_contains_work_id_section(self, tmp_path: Path):
        _run_init(tmp_path)
        content = (tmp_path / ".github" / "pull_request_template.md").read_text()
        assert "Work ID" in content

    def test_pr_template_contains_language_test_command(self, tmp_path: Path):
        _run_init(tmp_path, app_language="python")
        content = (tmp_path / ".github" / "pull_request_template.md").read_text()
        assert "uv run pytest" in content


# ---------------------------------------------------------------------------
# Amazon Q and Kiro files
# ---------------------------------------------------------------------------


class TestInitAiFiles:
    def test_creates_amazonq_golden_path(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".amazonq" / "rules" / "golden-path.md").exists()

    def test_creates_amazonq_dora(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".amazonq" / "rules" / "dora-and-audit.md").exists()

    def test_creates_kiro_product(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".kiro" / "steering" / "product.md").exists()

    def test_creates_kiro_tech(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".kiro" / "steering" / "tech.md").exists()

    def test_kiro_tech_mentions_language(self, tmp_path: Path):
        _run_init(tmp_path, app_language="go")
        content = (tmp_path / ".kiro" / "steering" / "tech.md").read_text()
        assert "go" in content.lower()

    def test_amazonq_mentions_language_adapter(self, tmp_path: Path):
        _run_init(tmp_path, app_language="typescript")
        content = (tmp_path / ".amazonq" / "rules" / "golden-path.md").read_text()
        assert "typescript" in content.lower()


# ---------------------------------------------------------------------------
# Git hooks
# ---------------------------------------------------------------------------


class TestInitGitHooks:
    def test_creates_commit_msg_hook(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".git" / "hooks" / "commit-msg").exists()

    def test_creates_pre_push_hook(self, tmp_path: Path):
        _run_init(tmp_path)
        assert (tmp_path / ".git" / "hooks" / "pre-push").exists()

    def test_hooks_are_executable(self, tmp_path: Path):
        import os
        _run_init(tmp_path)
        hook = tmp_path / ".git" / "hooks" / "commit-msg"
        assert os.access(hook, os.X_OK)

    def test_commit_msg_hook_contains_pattern(self, tmp_path: Path):
        _run_init(tmp_path)
        content = (tmp_path / ".git" / "hooks" / "commit-msg").read_text()
        assert "\\[" in content or "[A-Z]" in content  # Work ID regex fragment


# ---------------------------------------------------------------------------
# Force flag and idempotency
# ---------------------------------------------------------------------------


class TestInitForceFlag:
    def test_skips_existing_files_by_default(self, tmp_path: Path):
        _run_init(tmp_path)
        # Modify devex.yaml manually
        devex_yaml = tmp_path / "devex.yaml"
        devex_yaml.write_text("custom: true", encoding="utf-8")
        # Re-run without --force
        result, _ = _run_init(tmp_path)
        assert result.exit_code == 0
        # File should be unchanged
        assert "custom: true" in devex_yaml.read_text()

    def test_force_overwrites_existing_files(self, tmp_path: Path):
        (tmp_path / ".git" / "hooks").mkdir(parents=True, exist_ok=True)
        devex_yaml = tmp_path / "devex.yaml"
        devex_yaml.write_text("custom: true", encoding="utf-8")
        args = [
            "init",
            "--service", "svc",
            "--owner", "team",
            "--app-language", "python",
            "--infra", "aws-cdk-typescript",
            "--workflow-ref", "v0.1.0",
            "--root", str(tmp_path),
            "--skip-check",
            "--force",
        ]
        result = runner.invoke(app, args, catch_exceptions=False)
        assert result.exit_code == 0
        assert "custom: true" not in devex_yaml.read_text()
