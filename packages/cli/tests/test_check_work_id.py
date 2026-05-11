"""Unit tests for Work ID governance utilities.

Mirrors the assertions in packages/workflow-framework/test/work-id.test.ts
so that the Python CLI enforces the same rules.
"""

import pytest

from devex_cli.config.schema import WorkTrackingConfig
from devex_cli.governance.work_id import (
    recent_commits,
    validate_branch_name,
    validate_commit_message,
    validate_work_id,
)

DEFAULT = WorkTrackingConfig()


# ---------------------------------------------------------------------------
# validate_work_id
# ---------------------------------------------------------------------------


class TestValidateWorkId:
    def test_valid_work_id(self):
        result = validate_work_id("FIN-123", DEFAULT)
        assert result.valid is True
        assert result.work_id == "FIN-123"

    def test_valid_work_id_different_prefix(self):
        result = validate_work_id("PLAT-456", DEFAULT)
        assert result.valid is True
        assert result.work_id == "PLAT-456"

    def test_lowercase_rejected(self):
        result = validate_work_id("fin-123", DEFAULT)
        assert result.valid is False
        assert result.work_id is None

    def test_missing_number_rejected(self):
        result = validate_work_id("FIN", DEFAULT)
        assert result.valid is False

    def test_custom_pattern(self):
        cfg = WorkTrackingConfig(workIdPattern="^LP-[0-9]+$")
        assert validate_work_id("LP-99", cfg).valid is True
        assert validate_work_id("FIN-99", cfg).valid is False


# ---------------------------------------------------------------------------
# validate_branch_name
# ---------------------------------------------------------------------------


class TestValidateBranchName:
    @pytest.mark.parametrize(
        "branch",
        [
            "feature/FIN-123-add-validation",
            "fix/PLAT-456-broken-deploy",
            "chore/DEVEX-7-cleanup",
            "hotfix/PAY-1-urgent-fix",
        ],
    )
    def test_valid_branches(self, branch: str):
        result = validate_branch_name(branch, DEFAULT)
        assert result.valid is True
        assert result.work_id is not None

    @pytest.mark.parametrize(
        "branch",
        [
            "feature/add-validation",          # missing Work ID
            "main",                            # trunk branch
            "FIN-123-no-type-prefix",          # missing type prefix
            "feature/fin-123-lowercase-id",    # lowercase ID
        ],
    )
    def test_invalid_branches(self, branch: str):
        result = validate_branch_name(branch, DEFAULT)
        assert result.valid is False
        assert result.work_id is None

    def test_extracts_work_id(self):
        result = validate_branch_name("feature/FIN-123-some-change", DEFAULT)
        assert result.work_id == "FIN-123"


# ---------------------------------------------------------------------------
# validate_commit_message
# ---------------------------------------------------------------------------


class TestValidateCommitMessage:
    @pytest.mark.parametrize(
        "msg",
        [
            "[FIN-123] Add transaction validation",
            "[PLAT-456] Fix broken deploy pipeline",
            "[DEVEX-7] Refactor config loader",
        ],
    )
    def test_valid_commit_messages(self, msg: str):
        result = validate_commit_message(msg, DEFAULT)
        assert result.valid is True
        assert result.work_id is not None

    @pytest.mark.parametrize(
        "msg",
        [
            "Add transaction validation",          # no Work ID
            "FIN-123 Add transaction validation",  # no square brackets
            "[fin-123] lowercase ID",              # lowercase
        ],
    )
    def test_invalid_commit_messages(self, msg: str):
        result = validate_commit_message(msg, DEFAULT)
        assert result.valid is False

    def test_multiline_only_checks_first_line(self):
        msg = "[FIN-123] Subject line\n\nBody text without Work ID."
        result = validate_commit_message(msg, DEFAULT)
        assert result.valid is True

    def test_extracts_work_id(self):
        result = validate_commit_message("[FIN-123] Add validation", DEFAULT)
        assert result.work_id == "FIN-123"


# ---------------------------------------------------------------------------
# recent_commits — sinceCommit boundary
# ---------------------------------------------------------------------------


class TestRecentCommitsSinceBoundary:
    def test_falls_back_to_max_count_without_since(self, monkeypatch):
        """Without sinceCommit, uses --max-count."""
        import subprocess

        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            r = subprocess.CompletedProcess(cmd, 0)
            r.stdout = "[FIN-1] First\n[FIN-2] Second\n"
            return r

        monkeypatch.setattr("devex_cli.governance.work_id.subprocess.run", fake_run)
        msgs = recent_commits(n=3)
        assert "--max-count=3" in captured["cmd"]
        assert "FIN-1" in msgs[0]

    def test_uses_range_with_since_commit(self, monkeypatch):
        """With sinceCommit, uses '<sha>..HEAD' range."""
        import subprocess

        sha = "a" * 40
        captured = {}

        def fake_run(cmd, **kwargs):
            captured["cmd"] = cmd
            r = subprocess.CompletedProcess(cmd, 0)
            r.stdout = "[FIN-99] New commit\n"
            return r

        monkeypatch.setattr("devex_cli.governance.work_id.subprocess.run", fake_run)
        msgs = recent_commits(since_commit=sha)
        assert f"{sha}..HEAD" in captured["cmd"]
        assert msgs == ["[FIN-99] New commit"]

    def test_empty_range_returns_empty_list(self, monkeypatch):
        """No commits since init returns empty list (not an error)."""
        import subprocess

        def fake_run(cmd, **kwargs):
            r = subprocess.CompletedProcess(cmd, 0)
            r.stdout = ""
            return r

        monkeypatch.setattr("devex_cli.governance.work_id.subprocess.run", fake_run)
        assert recent_commits(since_commit="b" * 40) == []
