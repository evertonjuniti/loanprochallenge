"""`devex pr` — open a Golden-Path-compliant pull request via GitHub CLI.

Usage:
    devex pr --title "Add payment validation"
    # → gh pr create --title "[FIN-123] Add payment validation" --base main

    devex pr --title "fix fee calculation" --base develop --draft
    devex pr --title "..." --dry-run    # print command without executing

The Work ID is extracted automatically from the current branch name.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console

from devex_cli.governance.work_id import current_branch, validate_branch_name

app = typer.Typer(help="Open a Golden-Path-compliant pull request.")
console = Console()


@app.callback(invoke_without_command=True)
def pr(
    title: Annotated[
        str,
        typer.Option("--title", "-t", help="PR title (Work ID is prepended automatically)."),
    ],
    body_file: Annotated[
        Optional[Path],
        typer.Option(
            "--body-file",
            help="PR body file. Defaults to .github/pull_request_template.md when present.",
        ),
    ] = None,
    base: Annotated[
        str,
        typer.Option("--base", "-b", help="Target base branch."),
    ] = "main",
    draft: Annotated[
        bool,
        typer.Option("--draft", "-d", help="Open as a draft PR."),
    ] = False,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", "-n", help="Print the gh command without executing it."),
    ] = False,
) -> None:
    """Create a PR with a Work-ID-prefixed title using the GitHub CLI (gh)."""
    # ------------------------------------------------------------------
    # Resolve Work ID from current branch
    # ------------------------------------------------------------------
    branch = current_branch()
    if not branch:
        console.print(
            "[bold red]✗[/] Could not determine current branch. "
            "Are you inside a Git repository?"
        )
        raise typer.Exit(1)

    result = validate_branch_name(branch)
    if not result.valid or not result.work_id:
        console.print(
            f"[bold red]✗[/] Current branch '[yellow]{branch}[/]' does not contain a valid Work ID."
        )
        console.print(f"  {result.message}")
        console.print("  Use [bold]devex branch[/] to create a compliant branch first.")
        raise typer.Exit(1)

    work_id = result.work_id
    full_title = f"[{work_id}] {title}"

    # ------------------------------------------------------------------
    # Resolve PR body file
    # ------------------------------------------------------------------
    resolved_body: Optional[Path] = body_file
    if resolved_body is None:
        candidate = Path(".github") / "pull_request_template.md"
        if candidate.exists():
            resolved_body = candidate

    # ------------------------------------------------------------------
    # Build gh command
    # ------------------------------------------------------------------
    cmd: list[str] = ["gh", "pr", "create", "--title", full_title, "--base", base]
    if resolved_body and resolved_body.exists():
        cmd += ["--body-file", str(resolved_body)]
    else:
        # gh requires either --body or --body-file
        cmd += ["--body", ""]
    if draft:
        cmd.append("--draft")

    # ------------------------------------------------------------------
    # Display
    # ------------------------------------------------------------------
    console.print(f"[bold]PR title:[/] {full_title}")
    console.print(f"  Branch : [cyan]{branch}[/] → [cyan]{base}[/]")
    if resolved_body:
        console.print(f"  Body   : {resolved_body}")
    console.print()

    if dry_run:
        console.print("[dim]Would run:[/] " + " ".join(cmd))
        return

    # ------------------------------------------------------------------
    # Execute
    # ------------------------------------------------------------------
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError:
        # gh already printed the error
        raise typer.Exit(1)
    except FileNotFoundError:
        console.print(
            "[bold red]✗[/] GitHub CLI ('gh') is not installed or not in PATH.\n"
            "  Install from: https://cli.github.com"
        )
        raise typer.Exit(1)
