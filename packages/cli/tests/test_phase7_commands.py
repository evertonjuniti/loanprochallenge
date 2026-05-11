"""Tests for Phase 7 developer workflow commands:
  - devex branch
  - devex pr
  - devex validate
  - devex hooks install
  - devex upgrade
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from devex_cli.commands.branch import _slugify
from devex_cli.commands.upgrade import _replace_in_file
from devex_cli.main import app

runner = CliRunner()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MINIMAL_DEVEX_YAML = """\
schemaVersion: 1
service:
  name: my-service
  owner: platform-team
  type: microservice
workTracking:
  workIdPattern: "^[A-Z]+-[0-9]+$"
  branchPattern: "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$"
  commitPattern: "^\\\\[[A-Z]+-[0-9]+\\\\] .+"
  prTitlePattern: "^\\\\[[A-Z]+-[0-9]+\\\\] .+"
runtime:
  appLanguage: python
  infraLanguage: typescript
  infraFramework: aws-cdk-typescript
local:
  testCommand: "uv run pytest"
  lintCommand: "uv run ruff check ."
  contractTestCommand: "uv run pytest tests/contracts"
  propertyTestCommand: "uv run pytest tests/property"
ci:
  smallTests:
    unit: "uv run pytest tests/unit"
    property: "uv run pytest tests/property"
    contract: "uv run pytest tests/contracts"
    lint: "uv run ruff check ."
  cdk:
    workingDirectory: infra
    synthCommand: "pnpm cdk synth"
    diffCommand: "pnpm cdk diff"
    deployCommand: "pnpm cdk deploy --require-approval never"
environments:
  sandbox:
    awsRegion: us-east-1
    cdkStack: MyServiceSandbox
    githubEnvironment: sandbox
  staging:
    awsRegion: us-east-1
    cdkStack: MyServiceStaging
    githubEnvironment: staging
  production:
    awsRegion: us-east-1
    cdkStack: MyServiceProduction
    githubEnvironment: production
telemetry:
  sink: github-artifact
  auditFormat: ndjson
workflowVersion:
  ref: "v0.1.0"
"""


def _make_repo(tmp_path: Path, devex_yaml: str = _MINIMAL_DEVEX_YAML) -> Path:
    """Create a minimal fake Git repo with devex.yaml."""
    (tmp_path / ".git" / "hooks").mkdir(parents=True, exist_ok=True)
    (tmp_path / "devex.yaml").write_text(devex_yaml, encoding="utf-8")
    return tmp_path


# ===========================================================================
# devex branch
# ===========================================================================


class TestBranchSlugify:
    def test_spaces_become_hyphens(self):
        assert _slugify("add payment validation") == "add-payment-validation"

    def test_special_chars_removed(self):
        assert _slugify("Fix: fee calculation!") == "fix-fee-calculation"

    def test_multiple_spaces_collapse(self):
        assert _slugify("add   extra   spaces") == "add-extra-spaces"

    def test_leading_trailing_trimmed(self):
        assert _slugify("  trim me  ") == "trim-me"

    def test_uppercase_lowercased(self):
        assert _slugify("ADD UPPERCASE") == "add-uppercase"

    def test_numbers_preserved(self):
        assert _slugify("step 2 of 3") == "step-2-of-3"

    def test_empty_string(self):
        assert _slugify("") == ""


class TestBranchCommand:
    def test_dry_run_prints_branch_name(self):
        result = runner.invoke(app, ["branch", "FIN-123", "add payment validation", "--dry-run"])
        assert result.exit_code == 0
        assert "feature/FIN-123-add-payment-validation" in result.output

    def test_dry_run_no_description(self):
        result = runner.invoke(app, ["branch", "FIN-123", "--dry-run"])
        assert result.exit_code == 0
        assert "feature/FIN-123" in result.output

    def test_custom_type(self):
        result = runner.invoke(
            app, ["branch", "FIN-123", "critical fix", "--type", "hotfix", "--dry-run"]
        )
        assert result.exit_code == 0
        assert "hotfix/FIN-123-critical-fix" in result.output

    def test_invalid_work_id_exits_nonzero(self):
        result = runner.invoke(app, ["branch", "fin-123", "desc", "--dry-run"])
        assert result.exit_code != 0

    def test_invalid_branch_type_exits_nonzero(self):
        result = runner.invoke(app, ["branch", "FIN-123", "desc", "--type", "unknown", "--dry-run"])
        assert result.exit_code != 0

    def test_git_called_without_dry_run(self):
        with patch("devex_cli.commands.branch.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = runner.invoke(app, ["branch", "FIN-123", "my feature"])
            assert result.exit_code == 0
            mock_run.assert_called_once_with(
                ["git", "checkout", "-b", "feature/FIN-123-my-feature"], check=True
            )

    def test_git_failure_exits_nonzero(self):
        import subprocess

        with patch(
            "devex_cli.commands.branch.subprocess.run",
            side_effect=subprocess.CalledProcessError(1, "git"),
        ):
            result = runner.invoke(app, ["branch", "FIN-123", "desc"])
            assert result.exit_code != 0


# ===========================================================================
# devex pr
# ===========================================================================


class TestPrCommand:
    def test_dry_run_shows_work_id_title(self):
        with patch(
            "devex_cli.commands.pr.current_branch", return_value="feature/FIN-123-add-validation"
        ):
            result = runner.invoke(
                app, ["pr", "--title", "Add validation", "--dry-run"]
            )
        assert result.exit_code == 0
        assert "[FIN-123] Add validation" in result.output

    def test_dry_run_shows_gh_command(self):
        with patch(
            "devex_cli.commands.pr.current_branch", return_value="feature/FIN-123-add-validation"
        ):
            result = runner.invoke(
                app, ["pr", "--title", "Add validation", "--dry-run"]
            )
        assert "gh pr create" in result.output

    def test_invalid_branch_exits_nonzero(self):
        with patch("devex_cli.commands.pr.current_branch", return_value="feature/no-work-id"):
            result = runner.invoke(app, ["pr", "--title", "Some title"])
        assert result.exit_code != 0

    def test_no_branch_exits_nonzero(self):
        with patch("devex_cli.commands.pr.current_branch", return_value=None):
            result = runner.invoke(app, ["pr", "--title", "Some title"])
        assert result.exit_code != 0

    def test_draft_flag_included_in_command(self):
        with patch(
            "devex_cli.commands.pr.current_branch", return_value="feature/FIN-42-draft"
        ):
            result = runner.invoke(
                app, ["pr", "--title", "Draft PR", "--draft", "--dry-run"]
            )
        assert "--draft" in result.output

    def test_gh_not_installed_exits_nonzero(self):
        with patch(
            "devex_cli.commands.pr.current_branch", return_value="feature/FIN-99-thing"
        ):
            with patch(
                "devex_cli.commands.pr.subprocess.run",
                side_effect=FileNotFoundError("gh not found"),
            ):
                result = runner.invoke(app, ["pr", "--title", "Some title"])
        assert result.exit_code != 0
        assert "gh" in result.output.lower()

    def test_uses_pr_template_when_present(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        template = tmp_path / ".github" / "pull_request_template.md"
        template.parent.mkdir(parents=True)
        template.write_text("## Summary\n", encoding="utf-8")
        with patch(
            "devex_cli.commands.pr.current_branch", return_value="feature/FIN-7-feat"
        ):
            result = runner.invoke(
                app, ["pr", "--title", "Some title", "--dry-run"]
            )
        assert "pull_request_template.md" in result.output


# ===========================================================================
# devex validate
# ===========================================================================


class TestValidateCommand:
    def test_no_devex_yaml_exits_nonzero(self, tmp_path: Path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        result = runner.invoke(app, ["validate", "--skip-check"])
        assert result.exit_code != 0
        assert "devex.yaml" in result.output

    def test_passes_with_skip_flags(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        result = runner.invoke(
            app,
            [
                "validate",
                "--config", str(repo / "devex.yaml"),
                "--skip-check",
                "--skip-lint",
                "--skip-tests",
            ],
        )
        assert result.exit_code == 0
        assert "passed" in result.output

    def test_runs_lint_and_tests(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        with patch("devex_cli.commands.validate.subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            result = runner.invoke(
                app,
                [
                    "validate",
                    "--config", str(repo / "devex.yaml"),
                    "--skip-check",
                ],
            )
        assert result.exit_code == 0
        calls = [str(c) for c in mock_run.call_args_list]
        # lint and test commands from _MINIMAL_DEVEX_YAML
        assert any("ruff" in c for c in calls)
        assert any("pytest" in c for c in calls)

    def test_failed_step_exits_nonzero(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        with patch(
            "devex_cli.commands.validate.subprocess.run",
            return_value=MagicMock(returncode=1),
        ):
            result = runner.invoke(
                app,
                [
                    "validate",
                    "--config", str(repo / "devex.yaml"),
                    "--skip-check",
                ],
            )
        assert result.exit_code != 0
        assert "failed" in result.output


# ===========================================================================
# devex hooks install
# ===========================================================================


class TestHooksInstall:
    def test_installs_commit_msg_hook(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        result = runner.invoke(
            app,
            ["hooks", "install", "--config", str(repo / "devex.yaml"), "--root", str(repo)],
        )
        assert result.exit_code == 0
        assert (repo / ".git" / "hooks" / "commit-msg").exists()

    def test_installs_pre_push_hook(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        result = runner.invoke(
            app,
            ["hooks", "install", "--config", str(repo / "devex.yaml"), "--root", str(repo)],
        )
        assert result.exit_code == 0
        assert (repo / ".git" / "hooks" / "pre-push").exists()

    def test_hooks_are_executable(self, tmp_path: Path):
        import os

        repo = _make_repo(tmp_path)
        runner.invoke(
            app,
            ["hooks", "install", "--config", str(repo / "devex.yaml"), "--root", str(repo)],
        )
        for name in ("commit-msg", "pre-push"):
            hook = repo / ".git" / "hooks" / name
            assert os.access(hook, os.X_OK), f"{name} is not executable"

    def test_skips_existing_without_force(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        hook = repo / ".git" / "hooks" / "commit-msg"
        hook.write_text("original", encoding="utf-8")
        runner.invoke(
            app,
            ["hooks", "install", "--config", str(repo / "devex.yaml"), "--root", str(repo)],
        )
        assert hook.read_text(encoding="utf-8") == "original"

    def test_force_overwrites_existing(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        hook = repo / ".git" / "hooks" / "commit-msg"
        hook.write_text("original", encoding="utf-8")
        runner.invoke(
            app,
            [
                "hooks", "install",
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
                "--force",
            ],
        )
        assert hook.read_text(encoding="utf-8") != "original"

    def test_no_devex_yaml_exits_nonzero(self, tmp_path: Path):
        (tmp_path / ".git" / "hooks").mkdir(parents=True, exist_ok=True)
        result = runner.invoke(
            app, ["hooks", "install", "--root", str(tmp_path)]
        )
        assert result.exit_code != 0


# ===========================================================================
# devex upgrade
# ===========================================================================


class TestUpgradeReplaceInFile:
    def test_replaces_all_occurrences(self, tmp_path: Path):
        f = tmp_path / "devex.yaml"
        f.write_text('ref: "v0.1.0"\nuses: repo@v0.1.0\n', encoding="utf-8")
        updated: list[str] = []
        _replace_in_file(f, "v0.1.0", "v0.2.0", updated, dry_run=False)
        text = f.read_text(encoding="utf-8")
        assert "v0.1.0" not in text
        assert text.count("v0.2.0") == 2
        assert str(f) in updated

    def test_dry_run_does_not_modify_file(self, tmp_path: Path):
        f = tmp_path / "devex.yaml"
        original = 'ref: "v0.1.0"\n'
        f.write_text(original, encoding="utf-8")
        updated: list[str] = []
        _replace_in_file(f, "v0.1.0", "v0.2.0", updated, dry_run=True)
        assert f.read_text(encoding="utf-8") == original

    def test_no_match_skips_file(self, tmp_path: Path):
        f = tmp_path / "devex.yaml"
        f.write_text('ref: "v0.3.0"\n', encoding="utf-8")
        updated: list[str] = []
        _replace_in_file(f, "v0.1.0", "v0.2.0", updated, dry_run=False)
        assert updated == []


class TestUpgradeCommand:
    def test_invalid_version_exits_nonzero(self, tmp_path: Path):
        result = runner.invoke(app, ["upgrade", "--workflow-version", "main"])
        assert result.exit_code != 0

    def test_updates_devex_yaml(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        # Add a caller workflow so the upgrade can also update it
        wf_dir = repo / ".github" / "workflows"
        wf_dir.mkdir(parents=True, exist_ok=True)
        (wf_dir / "devex-pr.yml").write_text(
            "uses: loanpro/loanprochallenge/.github/workflows/pr.yml@v0.1.0\n",
            encoding="utf-8",
        )
        result = runner.invoke(
            app,
            [
                "upgrade",
                "--workflow-version", "v0.2.0",
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
            ],
        )
        assert result.exit_code == 0
        assert "v0.1.0" not in (repo / "devex.yaml").read_text(encoding="utf-8")
        assert "v0.2.0" in (repo / "devex.yaml").read_text(encoding="utf-8")

    def test_updates_caller_workflow(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        wf_dir = repo / ".github" / "workflows"
        wf_dir.mkdir(parents=True, exist_ok=True)
        wf_file = wf_dir / "devex-pr.yml"
        wf_file.write_text(
            "uses: loanpro/loanprochallenge/.github/workflows/pr.yml@v0.1.0\n",
            encoding="utf-8",
        )
        runner.invoke(
            app,
            [
                "upgrade",
                "--workflow-version", "v0.2.0",
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
            ],
        )
        assert "v0.2.0" in wf_file.read_text(encoding="utf-8")

    def test_dry_run_does_not_modify_files(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        original_yaml = (repo / "devex.yaml").read_text(encoding="utf-8")
        runner.invoke(
            app,
            [
                "upgrade",
                "--workflow-version", "v0.2.0",
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
                "--dry-run",
            ],
        )
        assert (repo / "devex.yaml").read_text(encoding="utf-8") == original_yaml

    def test_already_at_version_is_noop(self, tmp_path: Path):
        repo = _make_repo(tmp_path)
        result = runner.invoke(
            app,
            [
                "upgrade",
                "--workflow-version", "v0.1.0",  # same as current
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
            ],
        )
        assert result.exit_code == 0
        assert "nothing to do" in result.output.lower()

    def test_sha_version_accepted(self, tmp_path: Path):
        sha = "a" * 40
        repo = _make_repo(tmp_path)
        result = runner.invoke(
            app,
            [
                "upgrade",
                "--workflow-version", sha,
                "--config", str(repo / "devex.yaml"),
                "--root", str(repo),
            ],
        )
        # Should not exit with "invalid version" error (exit 1 from missing ref is ok)
        assert "invalid version" not in result.output.lower()
