"""Language defaults — Python-side mirror of the workflow-framework adapter registry.

Each entry maps an AppLanguage value (matching `runtime.appLanguage` in
devex.yaml / the TypeScript AppLanguageSchema enum) to the default commands
and metadata that `devex init` will write into the generated devex.yaml.

These defaults match what the corresponding workflow-framework LanguageAdapter
expects to find (or falls back to when the fields are absent).  Keeping them
in sync means a freshly-initialised repo builds and tests on first push.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

AppLanguage = Literal["python", "go", "typescript", "clojure", "java", "rust"]


@dataclass(frozen=True)
class LanguageDefaults:
    """Canonical CI and local commands for one application language."""

    #: Display name used in generated comments and Kiro steering files.
    display_name: str

    # ---- local commands (developer machine) --------------------------------
    test_command: str
    lint_command: str
    contract_test_command: str
    property_test_command: str

    # ---- CI commands (workflow-framework adapter) --------------------------
    ci_setup: str
    ci_unit: str
    ci_property: str
    ci_contract: str
    ci_lint: str

    #: Infra language typically paired with this app language.
    default_infra_language: Literal["typescript", "python", "go", "hcl", "none"] = "typescript"

    #: Additional notes for the generated Kiro steering / Amazon Q rules.
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

LANGUAGE_DEFAULTS: dict[str, LanguageDefaults] = {
    # ------------------------------------------------------------------
    # Python — managed with uv, tested with pytest, linted with ruff.
    # Matches PythonAdapter in workflow-framework.
    # ------------------------------------------------------------------
    "python": LanguageDefaults(
        display_name="Python (uv + pytest + ruff)",
        test_command="uv run pytest",
        lint_command="uvx ruff check .",
        contract_test_command="uv run pytest tests/contracts",
        property_test_command="uv run pytest tests/property",
        ci_setup="uv sync --frozen",
        ci_unit="uv run pytest tests/unit",
        ci_property="uv run pytest tests/property",
        ci_contract="uv run pytest tests/contracts",
        ci_lint="uvx ruff check .",
        default_infra_language="typescript",
        notes=[
            "Use `uv add <pkg>` to add dependencies.",
            "Run `uv run pytest` to execute the full test suite locally.",
            "Ruff replaces Black, isort, and flake8 — configure via pyproject.toml.",
        ],
    ),
    # ------------------------------------------------------------------
    # TypeScript — managed with pnpm, tested with vitest, linted with eslint.
    # Matches TypescriptAdapter in workflow-framework.
    # ------------------------------------------------------------------
    "typescript": LanguageDefaults(
        display_name="TypeScript (pnpm + vitest + eslint)",
        test_command="pnpm test",
        lint_command="pnpm run lint",
        contract_test_command="pnpm run test:contract",
        property_test_command="pnpm run test:property",
        ci_setup="pnpm install --no-frozen-lockfile",
        ci_unit="pnpm test",
        ci_property="pnpm run test:property",
        ci_contract="pnpm run test:contract",
        ci_lint="pnpm run lint",
        default_infra_language="typescript",
        notes=[
            "Use `pnpm add <pkg>` to add dependencies.",
            "Tests run with vitest via `pnpm test`.",
            "Lint with eslint via `pnpm run lint`.",
        ],
    ),
    # ------------------------------------------------------------------
    # Go — standard toolchain, tested with go test, linted with golangci-lint.
    # A GoAdapter in the workflow-framework would use these same commands.
    # ------------------------------------------------------------------
    "go": LanguageDefaults(
        display_name="Go (go modules + go test + golangci-lint)",
        test_command="go test ./...",
        lint_command="golangci-lint run",
        contract_test_command="go test ./tests/contracts/...",
        property_test_command="go test ./tests/property/...",
        ci_setup="go mod download",
        ci_unit="go test ./...",
        ci_property="go test ./tests/property/...",
        ci_contract="go test ./tests/contracts/...",
        ci_lint="golangci-lint run",
        default_infra_language="typescript",
        notes=[
            "Add dependencies with `go get <pkg>`.",
            "golangci-lint must be installed in CI (see golangci-lint GitHub Action).",
        ],
    ),
    # ------------------------------------------------------------------
    # Clojure — deps.edn, tested with clojure -M:test, linted with clj-kondo.
    # ------------------------------------------------------------------
    "clojure": LanguageDefaults(
        display_name="Clojure (deps.edn + clj-test + clj-kondo)",
        test_command="clojure -M:test",
        lint_command="clj-kondo --lint src",
        contract_test_command="clojure -M:test :contracts",
        property_test_command="clojure -M:test :property",
        ci_setup="clojure -P",
        ci_unit="clojure -M:test",
        ci_property="clojure -M:test :property",
        ci_contract="clojure -M:test :contracts",
        ci_lint="clj-kondo --lint src",
        default_infra_language="typescript",
        notes=[
            "Add dependencies in deps.edn under :deps.",
            "Test aliases are defined in deps.edn under :aliases.",
        ],
    ),
    # ------------------------------------------------------------------
    # Java — Maven or Gradle; here we default to Maven.
    # ------------------------------------------------------------------
    "java": LanguageDefaults(
        display_name="Java (Maven + JUnit + Checkstyle)",
        test_command="mvn test",
        lint_command="mvn checkstyle:check",
        contract_test_command="mvn test -Dtest=*ContractTest",
        property_test_command="mvn test -Dtest=*PropertyTest",
        ci_setup="mvn -q dependency:resolve",
        ci_unit="mvn test",
        ci_property="mvn test -Dtest=*PropertyTest",
        ci_contract="mvn test -Dtest=*ContractTest",
        ci_lint="mvn checkstyle:check",
        default_infra_language="typescript",
        notes=[
            "Add dependencies in pom.xml.",
            "Requires JDK 21+ in CI.",
        ],
    ),
    # ------------------------------------------------------------------
    # Rust — cargo, tested with cargo test, linted with clippy.
    # ------------------------------------------------------------------
    "rust": LanguageDefaults(
        display_name="Rust (cargo + cargo test + clippy)",
        test_command="cargo test",
        lint_command="cargo clippy -- -D warnings",
        contract_test_command="cargo test --test contracts",
        property_test_command="cargo test --test property",
        ci_setup="cargo fetch",
        ci_unit="cargo test",
        ci_property="cargo test --test property",
        ci_contract="cargo test --test contracts",
        ci_lint="cargo clippy -- -D warnings",
        default_infra_language="typescript",
        notes=[
            "Add dependencies with `cargo add <crate>`.",
            "Clippy treats warnings as errors in CI.",
        ],
    ),
}
