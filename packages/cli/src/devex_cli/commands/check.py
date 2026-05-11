"""`devex check` command — validates local Golden Path compliance.

Exit codes:
  0 — all checks passed.
  1 — one or more checks failed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console
from rich.table import Table

from devex_cli.config.loader import DevexConfigError, find_config, load_config
from devex_cli.governance.work_id import (
    current_branch,
    recent_commits,
    validate_branch_name,
    validate_commit_message,
)

app = typer.Typer(help="Validate Golden Path compliance for the current repository.")
console = Console()
err_console = Console(stderr=True)

# Approved workflow ref pattern — must be a semver tag or 40-char SHA.
_APPROVED_WORKFLOW_REF_RE = r"^(v\d+\.\d+\.\d+|[0-9a-f]{40})$"


# ---------------------------------------------------------------------------
# Main check command
# ---------------------------------------------------------------------------


@app.callback(invoke_without_command=True)
def check(
    config_path: Annotated[
        Optional[Path],
        typer.Option("--config", "-c", help="Path to devex.yaml (auto-discovered if omitted)."),
    ] = None,
    commits: Annotated[
        int,
        typer.Option("--commits", help="Number of recent commits to validate."),
    ] = 5,
) -> None:
    """Run all Golden Path compliance checks and report results."""
    results: list[tuple[bool, str, str]] = []  # (passed, label, detail)

    # ------------------------------------------------------------------
    # 1. devex.yaml presence and schema validity
    # ------------------------------------------------------------------
    resolved_path = config_path or find_config()
    if resolved_path is None:
        console.print("[bold red]✗[/] devex.yaml not found in this directory tree.")
        raise typer.Exit(code=1)

    try:
        cfg = load_config(resolved_path)
        results.append((True, "devex.yaml found", str(resolved_path)))
        results.append((True, "devex.yaml schema valid", f"service={cfg.service.name}"))
    except DevexConfigError as exc:
        results.append((True, "devex.yaml found", str(resolved_path)))
        results.append((False, "devex.yaml schema valid", str(exc)))
        _render(results)
        raise typer.Exit(code=1)

    # ------------------------------------------------------------------
    # 2. Branch name contains a Work ID
    # ------------------------------------------------------------------
    branch = current_branch()
    if branch is None:
        results.append((False, "Branch Work ID", "Not inside a Git repository."))
    else:
        branch_result = validate_branch_name(branch, cfg.workTracking)
        label = "Branch Work ID"
        detail = (
            f"Work ID {branch_result.work_id} found in branch '{branch}'"
            if branch_result.valid
            else branch_result.message
        )
        results.append((branch_result.valid, label, detail))

    # ------------------------------------------------------------------
    # 3. Recent commits contain Work IDs
    # ------------------------------------------------------------------
    since = cfg.workTracking.sinceCommit
    messages = recent_commits(commits, since_commit=since)
    commit_label = (
        "Commit Work IDs (since init)" if since else f"Commit Work IDs (last {commits})"
    )
    if not messages:
        no_commits_detail = (
            "No commits since DevEx initialisation."
            if since
            else "No commits found."
        )
        results.append((True, commit_label, no_commits_detail))
    else:
        failed_commits = [
            msg for msg in messages if not validate_commit_message(msg, cfg.workTracking).valid
        ]
        if failed_commits:
            results.append(
                (
                    False,
                    commit_label,
                    f"{len(failed_commits)} commit(s) missing Work ID: "
                    + "; ".join(f'"{m}"' for m in failed_commits[:3]),
                )
            )
        else:
            results.append(
                (True, commit_label, f"All {len(messages)} commits valid.")
            )

    # ------------------------------------------------------------------
    # 4. Caller workflow exists
    # ------------------------------------------------------------------
    repo_root = resolved_path.parent
    workflow_file = repo_root / ".github" / "workflows" / "devex-pr.yml"
    if workflow_file.exists():
        results.append((True, "PR workflow file", str(workflow_file.relative_to(repo_root))))
        # Check that the workflow pins a valid ref
        _check_workflow_ref(workflow_file, results)
    else:
        results.append(
            (
                False,
                "PR workflow file",
                ".github/workflows/devex-pr.yml not found. Run 'devex init' to create it.",
            )
        )

    # ------------------------------------------------------------------
    # 5. PR template exists
    # ------------------------------------------------------------------
    pr_template = repo_root / ".github" / "pull_request_template.md"
    if pr_template.exists():
        results.append((True, "PR template", str(pr_template.relative_to(repo_root))))
    else:
        results.append(
            (
                False,
                "PR template",
                ".github/pull_request_template.md not found. Run 'devex init' to create it.",
            )
        )

    # ------------------------------------------------------------------
    # 6. Amazon Q rules directory exists
    # ------------------------------------------------------------------
    amazonq_rules = repo_root / ".amazonq" / "rules"
    if amazonq_rules.is_dir() and any(amazonq_rules.iterdir()):
        results.append((True, "Amazon Q rules", str(amazonq_rules.relative_to(repo_root))))
    else:
        results.append(
            (
                False,
                "Amazon Q rules",
                ".amazonq/rules/ not found or empty. Run 'devex init' to create it.",
            )
        )

    # ------------------------------------------------------------------
    # 7. Kiro steering files exist
    # ------------------------------------------------------------------
    kiro_steering = repo_root / ".kiro" / "steering"
    if kiro_steering.is_dir() and any(kiro_steering.iterdir()):
        results.append((True, "Kiro steering files", str(kiro_steering.relative_to(repo_root))))
    else:
        results.append(
            (
                False,
                "Kiro steering files",
                ".kiro/steering/ not found or empty. Run 'devex init' to create it.",
            )
        )

    # ------------------------------------------------------------------
    # Render and exit
    # ------------------------------------------------------------------
    _render(results)
    failed = [r for r in results if not r[0]]
    if failed:
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_workflow_ref(workflow_file: Path, results: list[tuple[bool, str, str]]) -> None:
    """Scan the caller workflow YAML for a pinned framework ref."""
    import re

    content = workflow_file.read_text(encoding="utf-8")
    # Look for patterns like:  uses: org/repo/.github/workflows/pr.yml@v0.1.0
    match = re.search(r"uses:\s+\S+@(\S+)", content)
    if match:
        ref = match.group(1)
        import re as _re

        if _re.match(_APPROVED_WORKFLOW_REF_RE, ref):
            results.append((True, "Workflow framework ref", f"Pinned to {ref}"))
        else:
            results.append(
                (
                    False,
                    "Workflow framework ref",
                    f'Ref "{ref}" is not pinned to a semver tag or SHA. '
                    "Update devex-pr.yml to use a versioned ref (e.g. @v0.1.0).",
                )
            )
    else:
        results.append(
            (
                False,
                "Workflow framework ref",
                "Could not find a 'uses:' directive in devex-pr.yml.",
            )
        )


def _render(results: list[tuple[bool, str, str]]) -> None:
    table = Table(show_header=False, box=None, padding=(0, 1))
    for passed, label, detail in results:
        icon = "[bold green]✓[/]" if passed else "[bold red]✗[/]"
        status_color = "green" if passed else "red"
        table.add_row(icon, f"[{status_color}]{label}[/]", detail)
    console.print(table)
