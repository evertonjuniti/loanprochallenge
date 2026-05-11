"""adapters package — language-specific CI command defaults.

Mirrors the adapter registry in
packages/workflow-framework/src/adapters/index.ts so that `devex init`
generates a devex.yaml whose ci.smallTests and local commands are correct
for the chosen runtime, ready to be consumed by the workflow-framework
language adapters in CI.

When adding support for a new language:
  1. Add an entry to LANGUAGE_DEFAULTS below.
  2. Ensure the workflow-framework has a matching adapter (or add one).
"""

from devex_cli.adapters.language_defaults import LANGUAGE_DEFAULTS, LanguageDefaults

__all__ = ["LANGUAGE_DEFAULTS", "LanguageDefaults"]
