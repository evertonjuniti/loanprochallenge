"""`devex init` command — bootstraps a service repository onto the Golden Path.

Steps performed:
  1. Resolve the Git repo root.
  2. Resolve language defaults for the chosen appLanguage.
  3. Render and write devex.yaml (skips if already present unless --force).
  4. Render and write .github/workflows/devex-pr.yml.
  5. Render and write .github/pull_request_template.md.
  6. Render and write .amazonq/rules/*.md.
  7. Render and write .kiro/steering/*.md.
  8. Install Git hooks (commit-msg, pre-push).
  9. Run `devex check`.
"""

from __future__ import annotations

import re
import stat
import subprocess
from datetime import date
from pathlib import Path
from typing import Annotated, Optional

import typer
from jinja2 import Environment, PackageLoader, StrictUndefined
from rich.console import Console

from devex_cli.adapters.language_defaults import LANGUAGE_DEFAULTS

app = typer.Typer(help="Bootstrap a service repository onto the Golden Path.")
console = Console()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# GitHub org/repo that owns the centralized reusable workflow.
DEFAULT_ORG = "loanpro"
DEFAULT_REPO = "loanprochallenge"

_SUPPORTED_LANGUAGES = list(LANGUAGE_DEFAULTS.keys())
_SUPPORTED_INFRA = ["aws-cdk-typescript", "terraform", "pulumi", "none"]


# ---------------------------------------------------------------------------
# Command
# ---------------------------------------------------------------------------


@app.callback(invoke_without_command=True)
def init(
    service: Annotated[
        str,
        typer.Option("--service", "-s", prompt="Service name (e.g. transactionify)"),
    ],
    owner: Annotated[
        str,
        typer.Option("--owner", "-o", prompt="Team / owner name (e.g. payments-platform)"),
    ],
    app_language: Annotated[
        str,
        typer.Option(
            "--app-language",
            "-l",
            prompt=f"Application language ({', '.join(_SUPPORTED_LANGUAGES)})",
            help="Runtime language for the service application code.",
        ),
    ],
    infra: Annotated[
        str,
        typer.Option(
            "--infra",
            "-i",
            prompt=f"Infra framework ({', '.join(_SUPPORTED_INFRA)})",
        ),
    ] = "aws-cdk-typescript",
    workflow_ref: Annotated[
        str,
        typer.Option("--workflow-ref", prompt="Workflow framework version (e.g. v0.2.4)"),
    ] = "v0.2.4",
    service_type: Annotated[
        str,
        typer.Option("--service-type"),
    ] = "microservice",
    cdk_dir: Annotated[
        str,
        typer.Option("--cdk-dir", help="CDK working directory relative to repo root."),
    ] = "infra",
    org: Annotated[
        str,
        typer.Option("--org", help="GitHub organisation that owns the workflow framework repo."),
    ] = DEFAULT_ORG,
    repo: Annotated[
        str,
        typer.Option("--repo", help="GitHub repo that owns the workflow framework."),
    ] = DEFAULT_REPO,
    force: Annotated[
        bool,
        typer.Option("--force", "-f", help="Overwrite existing files."),
    ] = False,
    skip_check: Annotated[
        bool,
        typer.Option("--skip-check", help="Skip running devex check at the end."),
    ] = False,
    root: Annotated[
        Optional[Path],
        typer.Option("--root", help="Repository root path. Defaults to the Git root of cwd.", hidden=True),
    ] = None,
) -> None:
    """Bootstrap a service repository onto the Golden Path.

    Creates devex.yaml, the caller workflow, PR template, Git hooks,
    Amazon Q rules, and Kiro steering files.
    """
    # ------------------------------------------------------------------
    # Validate inputs
    # ------------------------------------------------------------------
    app_language = app_language.lower()
    if app_language not in LANGUAGE_DEFAULTS:
        console.print(
            f"[bold red]✗[/] Unknown language '{app_language}'. "
            f"Supported: {', '.join(_SUPPORTED_LANGUAGES)}"
        )
        raise typer.Exit(1)

    if infra not in _SUPPORTED_INFRA:
        console.print(
            f"[bold red]✗[/] Unknown infra '{infra}'. "
            f"Supported: {', '.join(_SUPPORTED_INFRA)}"
        )
        raise typer.Exit(1)

    # Normalize: add "v" prefix for bare semver tags (e.g. "0.3.1" → "v0.3.1").
    if re.match(r"^\d+\.\d+\.\d+", workflow_ref):
        workflow_ref = f"v{workflow_ref}"

    defaults = LANGUAGE_DEFAULTS[app_language]

    # ------------------------------------------------------------------
    # Resolve repo root
    # ------------------------------------------------------------------
    if root is not None:
        repo_root = root.resolve()
    else:
        repo_root = _find_git_root(Path.cwd())
    if repo_root is None:
        console.print("[bold red]✗[/] Not inside a Git repository. Run `git init` first.")
        raise typer.Exit(1)

    console.print(f"[bold]DevEx init[/] — {service} ({defaults.display_name})")
    console.print(f"  Repo root : {repo_root}")
    console.print(f"  Framework : {workflow_ref}")
    console.print()

    # ------------------------------------------------------------------
    # Build template context
    # ------------------------------------------------------------------
    infra_parts = infra.split("-")
    infra_language = infra_parts[2] if len(infra_parts) >= 3 else defaults.default_infra_language

    ctx = {
        "service_name": service,
        "service_pascal": _to_pascal(service),
        "owner": owner,
        "service_type": service_type,
        "app_language": app_language,
        "language_display": defaults.display_name,
        "infra_language": infra_language,
        "infra_framework": infra,
        "cdk_dir": cdk_dir,
        "workflow_ref": workflow_ref,
        "org": org,
        "repo": repo,
        # local commands
        "local_test": defaults.test_command,
        "local_lint": defaults.lint_command,
        "local_contract": defaults.contract_test_command,
        "local_property": defaults.property_test_command,
        # CI commands (consumed by workflow-framework language adapter)
        "ci_setup": defaults.ci_setup,
        "ci_unit": defaults.ci_unit,
        "ci_property": defaults.ci_property,
        "ci_contract": defaults.ci_contract,
        "ci_lint": defaults.ci_lint,
        # governance patterns (defaults — teams can override in devex.yaml)
        "work_id_pattern": "^[A-Z]+-[0-9]+$",
        "branch_pattern": "^(feature|fix|chore|hotfix)/[A-Z]+-[0-9]+-[a-z0-9-]+$",
        "commit_pattern": r"^\[[A-Z]+-[0-9]+\] .+",
        "pr_title_pattern": r"^\[[A-Z]+-[0-9]+\] .+",
        # sinceCommit — HEAD SHA at init time; devex check ignores older commits.
        "since_commit": _head_sha(repo_root),
        # telemetry
        "telemetry_sink": "github-artifact",
        # meta
        "generated_date": date.today().isoformat(),
        "language_notes": defaults.notes,
        "package_manager": _package_manager(app_language),
        "setup_hint": defaults.ci_setup,
    }

    # ------------------------------------------------------------------
    # Render templates
    # ------------------------------------------------------------------
    jinja_env = _make_jinja_env()

    _write(
        repo_root / "devex.yaml",
        jinja_env.get_template("devex.yaml.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".github" / "workflows" / "devex-pr.yml",
        jinja_env.get_template("pr-workflow.yml.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".github" / "pull_request_template.md",
        jinja_env.get_template("pull_request_template.md.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".amazonq" / "rules" / "golden-path.md",
        jinja_env.get_template("amazonq-golden-path.md.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".amazonq" / "rules" / "dora-and-audit.md",
        jinja_env.get_template("amazonq-dora-and-audit.md.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".kiro" / "steering" / "product.md",
        jinja_env.get_template("kiro-product.md.j2").render(**ctx),
        force=force,
    )
    _write(
        repo_root / ".kiro" / "steering" / "tech.md",
        jinja_env.get_template("kiro-tech.md.j2").render(**ctx),
        force=force,
    )

    # ------------------------------------------------------------------
    # Git hooks
    # ------------------------------------------------------------------
    _install_hook(
        repo_root / ".git" / "hooks" / "commit-msg",
        jinja_env.get_template("commit-msg-hook.j2").render(**ctx),
        force=force,
    )
    _install_hook(
        repo_root / ".git" / "hooks" / "pre-push",
        jinja_env.get_template("pre-push-hook.j2").render(**ctx),
        force=force,
    )

    console.print()
    console.print("[bold green]✓[/] devex init complete.")
    console.print()

    # ------------------------------------------------------------------
    # devex check
    # ------------------------------------------------------------------
    if not skip_check:
        console.print("[dim]Running devex check…[/]")
        console.print()
        try:
            # Re-invoke via the same Python process using the Typer app runner
            from typer.testing import CliRunner as TyperRunner

            runner = TyperRunner()
            from devex_cli.commands.check import app as check_app

            result = runner.invoke(
                check_app,
                ["--config", str(repo_root / "devex.yaml")],
            )
            console.print(result.output)
        except Exception:
            # If invocation fails, tell the user to run it manually
            console.print("[dim]Run `devex check` to verify compliance.[/]")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_jinja_env() -> Environment:
    return Environment(
        loader=PackageLoader("devex_cli", "templates"),
        keep_trailing_newline=True,
        undefined=StrictUndefined,
        autoescape=False,
    )


def _write(path: Path, content: str, *, force: bool) -> None:
    if path.exists() and not force:
        console.print(f"  [yellow]~[/] {path.name} already exists — skipped (use --force to overwrite)")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    console.print(f"  [green]✓[/] {path}")


def _install_hook(path: Path, content: str, *, force: bool) -> None:
    """Write a Git hook and make it executable."""
    if path.exists() and not force:
        console.print(f"  [yellow]~[/] {path.name} hook already exists — skipped")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    # Make executable (chmod +x)
    current = stat.S_IMODE(path.stat().st_mode)
    path.chmod(current | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    console.print(f"  [green]✓[/] {path} (hook, executable)")


def _find_git_root(start: Path) -> Optional[Path]:
    for directory in [start, *start.parents]:
        if (directory / ".git").exists():
            return directory
    return None


def _head_sha(repo_root: Path) -> Optional[str]:
    """Return the current HEAD commit SHA, or None when the repo has no commits."""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
        sha = result.stdout.strip()
        return sha if len(sha) == 40 else None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _to_pascal(slug: str) -> str:
    """Convert a slug like 'my-service' to PascalCase 'MyService'."""
    return "".join(word.capitalize() for word in slug.replace("_", "-").split("-"))


def _package_manager(language: str) -> str:
    return {
        "python": "uv",
        "typescript": "pnpm",
        "go": "go modules",
        "clojure": "deps.edn",
        "java": "Maven",
        "rust": "Cargo",
    }.get(language, "unknown")
