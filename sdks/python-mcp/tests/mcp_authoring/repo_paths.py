from __future__ import annotations

from pathlib import Path

import yaml


def lookup_mcp_fixtures() -> Path:
    here = Path(__file__).resolve()
    for parent in here.parents:
        manifest = parent / "contract" / "manifest" / "repo-paths.yaml"
        if manifest.is_file():
            loaded = yaml.safe_load(manifest.read_text())
            if not isinstance(loaded, dict):
                raise RuntimeError("repo-paths.yaml is not a mapping")
            lookups = loaded.get("lookups")
            if not isinstance(lookups, dict) or "mcpFixtures" not in lookups:
                raise RuntimeError("lookups.mcpFixtures is missing from repo-paths.yaml")
            rel = lookups["mcpFixtures"]
            if not isinstance(rel, str) or not rel:
                raise RuntimeError("lookups.mcpFixtures must be a non-empty string")
            return parent / rel
    raise RuntimeError("could not locate contract/manifest/repo-paths.yaml")
