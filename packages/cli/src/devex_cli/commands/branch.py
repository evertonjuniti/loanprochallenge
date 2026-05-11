"""`devex branch` — create a Golden-Path-compliant Git branch.

Usage:
    devex branch FIN-123 "add payment validation"
    # → git checkout -b feature/FIN-123-add-payment-validation

    devex branch FIN-123 "hotfix release" --type hotfix
    # → git checkout -b hotfix/FIN-123-hotfix-release

    devex branch FIN-123 --dry-run
    # → prints the branch name without running git
"""

from __future__ import annotations

import re
import subprocess
from typing import Annotated, Optional

import typer
from rich.console import Console

# NOTE: branch is registered as a direct app.command in main.py rather than via
# add_typer because Click Groups (Typer sub-apps) do not support positional
# Arguments in callbacks.  Using app.command avoids that limitation.

console = Console()

_BRANCH_TYPES = ["feature", "fix", "chore", "hotfix"]
_WORK_ID_RE = re.compile(r"^[A-Z]+-[0-9]+$")


def branch(
    work_id: Annotated[str, typer.Argument(help="Work ID (e.g. FIN-123).")],
    description: Annotated[
        Optional[str],
        typer.Argument(help="Short description (e.g. 'add payment validation')."),
    ] = None,
    branch_type: Annotated[
        str,
        typer.Option(
            "--type",
            "-t",
            help=f"Branch type prefix. One of: {', '.join(_BRANCH_TYPES)}.",
        ),
    ] = "feature",
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", "-n", help="Print the branch name without creating it."),
    ] = False,
) -> None:
    """Create a Golden-Path-compliant branch: <type>/<WORK-ID>[-<description>]."""
    # Validate work_id
    if not _WORK_ID_RE.match(work_id):
        console.print(
            f"[bold red]✗[/] Invalid Work ID '{work_id}'. "
            "Expected format: PROJECT-NUMBER (e.g. FIN-123)."
        )
        raise typer.Exit(1)

    if branch_type not in _BRANCH_TYPES:
        console.print(
            f"[bold red]✗[/] Invalid branch type '{branch_type}'. "
            f"Supported types: {', '.join(_BRANCH_TYPES)}"
        )
        raise typer.Exit(1)

    # Build branch name
    slug = _slugify(description) if description else ""
    branch_name = f"{branch_type}/{work_id}-{slug}" if slug else f"{branch_type}/{work_id}"

    if dry_run:
        console.print(branch_name)
        return

    console.print(f"[bold]Creating branch:[/] {branch_name}")
    try:
        subprocess.run(["git", "checkout", "-b", branch_name], check=True)
        console.print(f"[green]✓[/] Switched to new branch '{branch_name}'")
    except subprocess.CalledProcessError:
        # git already printed its error; just exit non-zero
        raise typer.Exit(1)
    except FileNotFoundError:
        console.print("[bold red]✗[/] git is not installed or not in PATH.")
        raise typer.Exit(1)


def _slugify(text: str) -> str:
    """Convert arbitrary text to a lowercase hyphenated slug.

    Examples:
        "Add payment validation" → "add-payment-validation"
        "Fix: fee calculation!"  → "fix-fee-calculation"
    """
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")
