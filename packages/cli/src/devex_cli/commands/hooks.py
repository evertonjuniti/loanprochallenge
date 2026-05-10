"""`devex hooks` — install or reinstall Git hooks for a service repository.

Sub-commands:
    devex hooks install          — install commit-msg and pre-push hooks
    devex hooks install --force  — overwrite existing hooks

The hooks are rendered from the same Jinja2 templates used by `devex init`,
using the language defaults declared in devex.yaml.
"""

from __future__ import annotations

import stat
from pathlib import Path
from typing import Annotated, Optional

import typer
from jinja2 import Environment, PackageLoader, StrictUndefined
from rich.console import Console

from datetime import date

from devex_cli.adapters.language_defaults import LANGUAGE_DEFAULTS
from devex_cli.commands.init import _find_git_root
from devex_cli.config.loader import DevexConfigError, find_config, load_config

app = typer.Typer(help="Manage Git hooks for Golden Path compliance.")
console = Console()


@app.command("install")
def install(
    config: Annotated[
        Optional[Path],
        typer.Option("--config", "-c", help="Path to devex.yaml."),
    ] = None,
    force: Annotated[
        bool,
        typer.Option("--force", "-f", help="Overwrite existing hooks."),
    ] = False,
    root: Annotated[
        Optional[Path],
        typer.Option("--root", help="Repository root override (for testing).", hidden=True),
    ] = None,
) -> None:
    """Install commit-msg and pre-push Git hooks from devex.yaml settings."""
    # ------------------------------------------------------------------
    # Resolve repo root
    # ------------------------------------------------------------------
    repo_root = root.resolve() if root is not None else _find_git_root(Path.cwd())
    if repo_root is None:
        console.print(
            "[bold red]✗[/] Not inside a Git repository. Run [bold]git init[/] first."
        )
        raise typer.Exit(1)

    # ------------------------------------------------------------------
    # Load devex.yaml
    # ------------------------------------------------------------------
    config_path = config or find_config(repo_root)
    if config_path is None:
        console.print(
            "[bold red]✗[/] devex.yaml not found. Run [bold]devex init[/] first."
        )
        raise typer.Exit(1)

    try:
        cfg = load_config(config_path)
    except DevexConfigError as exc:
        console.print(f"[bold red]✗[/] {exc}")
        raise typer.Exit(1)

    lang = cfg.runtime.appLanguage
    defaults = LANGUAGE_DEFAULTS.get(lang)
    if defaults is None:
        console.print(f"[bold red]✗[/] Unknown language '{lang}' in devex.yaml.")
        raise typer.Exit(1)

    # ------------------------------------------------------------------
    # Render and install hooks
    # ------------------------------------------------------------------
    jinja_env = Environment(
        loader=PackageLoader("devex_cli", "templates"),
        keep_trailing_newline=True,
        undefined=StrictUndefined,
        autoescape=False,
    )

    ctx = {
        "service_name": cfg.service.name,
        "commit_pattern": cfg.workTracking.commitPattern,
        "local_lint": defaults.lint_command,
        "local_test": defaults.test_command,
        "local_contract": defaults.contract_test_command,
        "local_property": defaults.property_test_command,
        "generated_date": date.today().isoformat(),
    }

    console.print(f"[bold]devex hooks install[/] — {cfg.service.name}")
    console.print()

    _write_hook(
        repo_root / ".git" / "hooks" / "commit-msg",
        jinja_env.get_template("commit-msg-hook.j2").render(**ctx),
        force=force,
    )
    _write_hook(
        repo_root / ".git" / "hooks" / "pre-push",
        jinja_env.get_template("pre-push-hook.j2").render(**ctx),
        force=force,
    )

    console.print()
    console.print("[bold green]✓[/] Git hooks installed.")


def _write_hook(path: Path, content: str, *, force: bool) -> None:
    """Write a hook script and make it executable."""
    if path.exists() and not force:
        console.print(
            f"  [yellow]~[/] {path.name} already exists — skipped (use --force to overwrite)"
        )
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    current = stat.S_IMODE(path.stat().st_mode)
    path.chmod(current | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    console.print(f"  [green]✓[/] {path.name} (hook, executable)")
