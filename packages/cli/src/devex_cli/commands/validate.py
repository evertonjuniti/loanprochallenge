"""`devex validate` — run local Golden Path compliance checks.

Runs in order:
  1. devex check          — config / branch / commit / file compliance
  2. lint command         — from devex.yaml local.lintCommand
  3. unit tests           — from devex.yaml local.testCommand
  4. property tests       — from devex.yaml local.propertyTestCommand (if set)
  5. contract tests       — from devex.yaml local.contractTestCommand (if set)

Usage:
    devex validate
    devex validate --skip-check        # skip devex check
    devex validate --skip-lint         # skip lint
    devex validate --skip-tests        # skip all test commands
    devex validate --config path/to/devex.yaml
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Annotated, Optional

import typer
from rich.console import Console

from devex_cli.config.loader import DevexConfigError, find_config, load_config

app = typer.Typer(help="Run local Golden Path compliance checks and test commands.")
console = Console()


@app.callback(invoke_without_command=True)
def validate(
    config: Annotated[
        Optional[Path],
        typer.Option("--config", "-c", help="Path to devex.yaml."),
    ] = None,
    skip_check: Annotated[
        bool,
        typer.Option("--skip-check", help="Skip running devex check."),
    ] = False,
    skip_lint: Annotated[
        bool,
        typer.Option("--skip-lint", help="Skip the lint command."),
    ] = False,
    skip_tests: Annotated[
        bool,
        typer.Option("--skip-tests", help="Skip all test commands."),
    ] = False,
) -> None:
    """Run devex check, lint, and local test commands from devex.yaml."""
    # ------------------------------------------------------------------
    # Resolve and load devex.yaml
    # ------------------------------------------------------------------
    config_path = config or find_config()
    if config_path is None:
        console.print(
            "[bold red]✗[/] devex.yaml not found. "
            "Run [bold]devex init[/] to bootstrap the repository."
        )
        raise typer.Exit(1)

    try:
        cfg = load_config(config_path)
    except DevexConfigError as exc:
        console.print(f"[bold red]✗[/] {exc}")
        raise typer.Exit(1)

    failures: list[str] = []

    # ------------------------------------------------------------------
    # 1. devex check
    # ------------------------------------------------------------------
    if not skip_check:
        console.rule("[bold]devex check[/]")
        from typer.testing import CliRunner

        from devex_cli.commands.check import app as check_app

        runner = CliRunner()
        result = runner.invoke(check_app, ["--config", str(config_path)])
        console.print(result.output.rstrip())
        if result.exit_code != 0:
            failures.append("devex check")
        console.print()

    local = cfg.local

    if local is None:
        console.print(
            "[dim]No local commands configured in devex.yaml — skipping lint and tests.[/]"
        )
    else:
        # 2. Lint
        if not skip_lint and local.lintCommand:
            _run_step(f"Lint: {local.lintCommand}", local.lintCommand, failures)

        # 3. Unit tests
        if not skip_tests and local.testCommand:
            _run_step(f"Tests: {local.testCommand}", local.testCommand, failures)

        # 4. Property tests
        if not skip_tests and local.propertyTestCommand:
            _run_step(
                f"Property tests: {local.propertyTestCommand}",
                local.propertyTestCommand,
                failures,
            )

        # 5. Contract tests
        if not skip_tests and local.contractTestCommand:
            _run_step(
                f"Contract tests: {local.contractTestCommand}",
                local.contractTestCommand,
                failures,
            )

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    console.rule()
    if failures:
        console.print(
            f"[bold red]✗[/] {len(failures)} step(s) failed: {', '.join(failures)}"
        )
        raise typer.Exit(1)
    else:
        console.print("[bold green]✓[/] All validations passed.")


def _run_step(label: str, cmd: str, failures: list[str]) -> None:
    """Run a shell command and accumulate failures."""
    console.rule(f"[bold]{label}[/]")
    proc = subprocess.run(cmd, shell=True)  # noqa: S602 — cmd comes from user's devex.yaml
    if proc.returncode != 0:
        console.print(f"[bold red]✗[/] Failed: {cmd}")
        failures.append(label)
    else:
        console.print(f"[green]✓[/] {cmd}")
    console.print()
