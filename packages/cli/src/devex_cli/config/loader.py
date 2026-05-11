"""Load and validate a devex.yaml file from disk."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml
from pydantic import ValidationError

from devex_cli.config.schema import DevexConfig


class DevexConfigError(Exception):
    """Raised when devex.yaml cannot be loaded or fails schema validation."""


def load_config(path: Path) -> DevexConfig:
    """Parse and validate a devex.yaml file.

    Args:
        path: Absolute or relative path to the devex.yaml file.

    Returns:
        A fully validated :class:`DevexConfig` instance with schema defaults
        applied.

    Raises:
        DevexConfigError: If the file is missing, unreadable, not valid YAML,
            or does not satisfy the schema.
    """
    if not path.exists():
        raise DevexConfigError(f"devex.yaml not found at: {path}")

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise DevexConfigError(f"devex.yaml is not valid YAML: {exc}") from exc

    if not isinstance(raw, dict):
        raise DevexConfigError("devex.yaml must be a YAML mapping at the top level.")

    try:
        return DevexConfig.model_validate(raw)
    except ValidationError as exc:
        lines = []
        for error in exc.errors():
            field = ".".join(str(p) for p in error["loc"]) or "(root)"
            lines.append(f"  • {field}: {error['msg']}")
        raise DevexConfigError("Invalid devex.yaml:\n" + "\n".join(lines)) from exc


def find_config(start: Optional[Path] = None) -> Optional[Path]:
    """Walk up the directory tree looking for a devex.yaml file.

    Args:
        start: Directory to start from (defaults to current working directory).

    Returns:
        The first devex.yaml found, or *None* if none exists in the tree.
    """
    current = (start or Path.cwd()).resolve()
    for directory in [current, *current.parents]:
        candidate = directory / "devex.yaml"
        if candidate.exists():
            return candidate
    return None
