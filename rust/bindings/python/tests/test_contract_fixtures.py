"""Step 42 — offline Python golden-fixture contract suite."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from contract.compare import assert_expect
from contract.dispatch import replay_fixture
from contract.fixture_loader import discover_fixture_files, find_repo_root, load_fixture
from contract.names import camel_to_kebab, is_error_case, is_success_case

REPO_ROOT = find_repo_root(Path(__file__))
FIXTURES_ROOT = REPO_ROOT / "contract" / "fixtures"
MANIFEST_PATH = REPO_ROOT / "contract" / "manifest" / "sdk-contract.yaml"

FIXTURE_FILES = discover_fixture_files(FIXTURES_ROOT)
FIXTURE_IDS = [str(path.relative_to(FIXTURES_ROOT)) for path in FIXTURE_FILES]


def _parse_manifest_operation_ts_names(manifest_text: str) -> list[str]:
    """Extract `operations.*.names.ts` without PyYAML (stdlib-only)."""
    # Narrow to the top-level `operations:` block.
    match = re.search(r"^operations:\n(.*?)(?=^\S|\Z)", manifest_text, re.M | re.S)
    if not match:
        raise AssertionError("manifest missing top-level operations:")
    block = match.group(1)
    names: list[str] = []
    current_op = False
    in_names = False
    for line in block.splitlines():
        if re.match(r"^  [A-Za-z0-9_]+:\s*$", line):
            current_op = True
            in_names = False
            continue
        if current_op and line.strip() == "names:":
            in_names = True
            continue
        if in_names:
            ts = re.match(r"^      ts:\s*(\S+)\s*$", line)
            if ts:
                names.append(ts.group(1))
                current_op = False
                in_names = False
                continue
            if line.startswith("    ") and not line.startswith("      "):
                in_names = False
        if current_op and re.match(r"^  [A-Za-z0-9_]+:\s*$", line):
            pass
    return names


def test_covers_every_manifest_client_operation() -> None:
    ops = _parse_manifest_operation_ts_names(MANIFEST_PATH.read_text(encoding="utf-8"))
    assert len(ops) == 36

    relative = [str(path.relative_to(FIXTURES_ROOT)) for path in FIXTURE_FILES]
    missing: list[str] = []
    for op_ts in ops:
        method_dir = camel_to_kebab(op_ts)
        prefix = f"client/{method_dir}/"
        files = [
            Path(rel).stem for rel in relative if rel.startswith(prefix)
        ]
        has_success = any(is_success_case(name) for name in files)
        has_error = any(is_error_case(name) for name in files)
        if not has_success or not has_error:
            missing.append(
                f"{op_ts} ({method_dir}): success={has_success} error={has_error} "
                f"files=[{', '.join(files)}]"
            )
    assert missing == []


@pytest.mark.parametrize("relative,path", list(zip(FIXTURE_IDS, FIXTURE_FILES, strict=True)))
def test_replay_fixture(relative: str, path: Path) -> None:
    fixture = load_fixture(path)
    outcome = replay_fixture(fixture)
    assert_expect(outcome, fixture)
