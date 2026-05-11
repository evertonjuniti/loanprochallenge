"""Work ID governance utilities — Python mirror of governance/work-id.ts.

Enforces the same branch-name, commit-message, and Work ID rules locally
that the workflow-framework CI pipeline enforces remotely.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from typing import Optional

from devex_cli.config.schema import WorkTrackingConfig

# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------


@dataclass
class WorkIdResult:
    valid: bool
    work_id: Optional[str]
    message: str


# ---------------------------------------------------------------------------
# Core validators
# ---------------------------------------------------------------------------


def validate_work_id(value: str, config: WorkTrackingConfig = WorkTrackingConfig()) -> WorkIdResult:
    """Validate a bare Work ID string against the configured pattern."""
    if re.match(config.workIdPattern, value.strip()):
        return WorkIdResult(valid=True, work_id=value.strip(), message="Work ID is valid.")
    return WorkIdResult(
        valid=False,
        work_id=None,
        message=(
            f'"{value}" does not match the required Work ID pattern: {config.workIdPattern}. '
            "Expected format: PROJECT-NUMBER (e.g. FIN-123)."
        ),
    )


def validate_branch_name(
    branch: str, config: WorkTrackingConfig = WorkTrackingConfig()
) -> WorkIdResult:
    """Validate a branch name and extract the embedded Work ID."""
    if not re.match(config.branchPattern, branch):
        return WorkIdResult(
            valid=False,
            work_id=None,
            message=(
                f'Branch name "{branch}" does not match the required pattern:\n'
                f"  {config.branchPattern}\n"
                "Expected format: <type>/<WORK-ID>-<description> "
                "(e.g. feature/FIN-123-add-transaction-validation)."
            ),
        )
    work_id = _extract_work_id_from_branch(branch, config)
    msg = f"Branch contains Work ID {work_id}." if work_id else "Branch is valid."
    return WorkIdResult(valid=True, work_id=work_id, message=msg)


def validate_commit_message(
    message: str, config: WorkTrackingConfig = WorkTrackingConfig()
) -> WorkIdResult:
    """Validate the first line of a commit message."""
    first_line = message.split("\n")[0].strip()
    if not re.match(config.commitPattern, first_line):
        return WorkIdResult(
            valid=False,
            work_id=None,
            message=(
                f'Commit message "{first_line}" does not match the required pattern:\n'
                f"  {config.commitPattern}\n"
                "Expected format: [WORK-ID] Description (e.g. [FIN-123] Add validation)."
            ),
        )
    work_id = _extract_work_id_from_text(first_line, config)
    msg = f"Commit message contains Work ID {work_id}." if work_id else "Commit message is valid."
    return WorkIdResult(valid=True, work_id=work_id, message=msg)


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------


def current_branch() -> Optional[str]:
    """Return the current Git branch name, or None when not in a Git repo."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        branch = result.stdout.strip()
        return branch if branch and branch != "HEAD" else None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def recent_commits(n: int = 5) -> list[str]:
    """Return the first lines of the *n* most recent commit messages."""
    try:
        result = subprocess.run(
            ["git", "log", f"--max-count={n}", "--format=%s"],
            capture_output=True,
            text=True,
            check=True,
        )
        return [line for line in result.stdout.splitlines() if line.strip()]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _strip_anchors(pattern: str) -> str:
    """Remove leading ^ and trailing $ anchors so the pattern can match within a longer string."""
    return pattern.lstrip("^").rstrip("$")


def _extract_work_id_from_branch(branch: str, config: WorkTrackingConfig) -> Optional[str]:
    """Pull the Work ID segment out of a branch name like feature/FIN-123-foo."""
    match = re.search(_strip_anchors(config.workIdPattern), branch)
    return match.group(0) if match else None


def _extract_work_id_from_text(text: str, config: WorkTrackingConfig) -> Optional[str]:
    """Pull the Work ID out of a commit message or PR title."""
    match = re.search(_strip_anchors(config.workIdPattern), text)
    return match.group(0) if match else None
