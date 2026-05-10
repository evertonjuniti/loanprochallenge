"""Main Typer application — registers all devex sub-commands."""

import typer

from devex_cli.commands import branch, check, hooks, init, pr, upgrade, validate

app = typer.Typer(
    name="devex",
    help=(
        "LoanPro DevEx Golden Path CLI.\n\n"
        "Standardizes Git conventions, validates devex.yaml, and connects "
        "service repositories to the central workflow framework."
    ),
    no_args_is_help=True,
)

app.add_typer(init.app, name="init")
app.add_typer(check.app, name="check")
# branch uses positional Arguments so it must be a direct command, not a sub-app.
app.command("branch", help="Create a Golden-Path-compliant Git branch.")(branch.branch)
app.add_typer(pr.app, name="pr")
app.add_typer(validate.app, name="validate")
app.add_typer(hooks.app, name="hooks")
app.add_typer(upgrade.app, name="upgrade")


if __name__ == "__main__":
    app()
