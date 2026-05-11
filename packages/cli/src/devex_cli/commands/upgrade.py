"""`devex upgrade` — update the workflow framework version across a service repo.

Updates every occurrence of the current `workflowVersion.ref` with the new
version in:
  - devex.yaml              (workflowVersion.ref field + inline refs)
  - .github/workflows/devex-pr.yml  (@ref in the `uses:` line)

Usage:
    devex upgrade --workflow-version v0.3.0
    devex upgrade --workflow-version v0.3.0 --dry-run
    devex upgrade --workflow-version abc123...  (40-char SHA)
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console

from devex_cli.commands.init import _find_git_root
from devex_cli.config.loader import DevexConfigError, find_config, load_config

app = typer.Typer(help="Upgrade the DevEx workflow framework version in a service repository.")
console = Console()

_VERSION_RE = re.compile(r"^(v\d+\.\d+\.\d+|[0-9a-f]{40})$")


@app.callback(invoke_without_command=True)
def upgrade(
    workflow_version: Annotated[
        str,
        typer.Option(
            "--workflow-version",
            "-v",
            help="New workflow version tag (e.g. v0.3.0) or 40-char SHA.",
        ),
    ],
    config: Annotated[
        Optional[Path],
        typer.Option("--config", "-c", help="Path to devex.yaml."),
    ] = None,
    root: Annotated[
        Optional[Path],
        typer.Option("--root", help="Repository root override (for testing).", hidden=True),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", "-n", help="Show what would change without writing files."),
    ] = False,
) -> None:
    """Replace the workflow @ref in devex.yaml and the caller workflow file."""
    # ------------------------------------------------------------------
    # Validate new version format
    # ------------------------------------------------------------------
    if not _VERSION_RE.match(workflow_version):
        console.print(
            f"[bold red]✗[/] Invalid version '{workflow_version}'. "
            "Expected: vX.Y.Z or a 40-character commit SHA."
        )
        raise typer.Exit(1)

    # ------------------------------------------------------------------
    # Resolve repo root and config
    # ------------------------------------------------------------------
    repo_root = root.resolve() if root is not None else _find_git_root(Path.cwd())
    if repo_root is None:
        console.print("[bold red]✗[/] Not inside a Git repository.")
        raise typer.Exit(1)

    config_path = config or find_config(repo_root)
    if config_path is None:
        console.print("[bold red]✗[/] devex.yaml not found.")
        raise typer.Exit(1)

    try:
        cfg = load_config(config_path)
    except DevexConfigError as exc:
        console.print(f"[bold red]✗[/] {exc}")
        raise typer.Exit(1)

    old_ref = cfg.workflowVersion.ref

    if old_ref == workflow_version:
        console.print(
            f"[yellow]~[/] Already at version [bold]{workflow_version}[/] — nothing to do."
        )
        return

    # ------------------------------------------------------------------
    # Update files
    # ------------------------------------------------------------------
    console.print(f"[bold]devex upgrade[/] — {cfg.service.name}")
    console.print(f"  [dim]{old_ref}[/] → [bold green]{workflow_version}[/]")
    console.print()

    updated_paths: list[str] = []

    # devex.yaml
    _replace_in_file(config_path, old_ref, workflow_version, updated_paths, dry_run=dry_run)

    # caller workflow
    workflow_file = repo_root / ".github" / "workflows" / "devex-pr.yml"
    if workflow_file.exists():
        _replace_in_file(
            workflow_file, old_ref, workflow_version, updated_paths, dry_run=dry_run
        )
    else:
        console.print(f"  [yellow]~[/] {workflow_file.name} not found — skipped")

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    console.print()
    if not updated_paths:
        console.print(
            f"  [yellow]~[/] No occurrences of '{old_ref}' found in the target files."
        )
    elif dry_run:
        console.print("[dim]Dry run — no files were written.[/]")
    else:
        console.print(f"[bold green]✓[/] Upgraded to {workflow_version}.")


def _replace_in_file(
    path: Path,
    old_ref: str,
    new_ref: str,
    updated: list[str],
    *,
    dry_run: bool,
) -> None:
    """Replace all occurrences of *old_ref* with *new_ref* in *path*."""
    text = path.read_text(encoding="utf-8")
    count = text.count(old_ref)
    if count == 0:
        console.print(f"  [yellow]~[/] {path.name} — ref '{old_ref}' not found, skipped")
        return

    new_text = text.replace(old_ref, new_ref)
    noun = "occurrence" if count == 1 else "occurrences"

    if dry_run:
        console.print(f"  [dim]Would update[/] {path.name} ({count} {noun})")
    else:
        path.write_text(new_text, encoding="utf-8")
        console.print(f"  [green]✓[/] {path.name} ({count} {noun} updated)")

    updated.append(str(path))
