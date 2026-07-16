#!/usr/bin/env bash
# Belt-and-braces companion to Clippy unwrap_used / expect_used (§4.4).
# Scans production Rust under rust/ and fails on .unwrap() / .expect() /
# unwrap_err() / expect_err() / panic!(...). Skips #[cfg(test)] modules and
# files under tests/ directories.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from __future__ import annotations

import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
forbidden = re.compile(
    r"""(?x)
    \.unwrap\s*\(
  | \.unwrap_err\s*\(
  | \.expect\s*\(
  | \.expect_err\s*\(
  | \bpanic\s*!
    """
)
cfg_test_start = re.compile(r"#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]")
mod_or_fn = re.compile(r"^\s*(?:pub\s+)?(?:mod|fn)\s+\w+")

violations: list[str] = []


def production_lines(text: str) -> list[tuple[int, str]]:
    """Yield (1-based line no, line) outside #[cfg(test)] modules/fns."""
    lines = text.splitlines()
    out: list[tuple[int, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if cfg_test_start.search(line):
            # Skip attribute + following item (mod/fn) including its body.
            j = i + 1
            while j < len(lines) and lines[j].strip() == "":
                j += 1
            if j < len(lines) and mod_or_fn.search(lines[j]):
                # Find opening brace on this or following lines.
                k = j
                while k < len(lines) and "{" not in lines[k]:
                    k += 1
                if k >= len(lines):
                    break
                depth = 0
                started = False
                while k < len(lines):
                    for ch in lines[k]:
                        if ch == "{":
                            depth += 1
                            started = True
                        elif ch == "}":
                            depth -= 1
                    k += 1
                    if started and depth == 0:
                        break
                i = k
                continue
        out.append((i + 1, line))
        i += 1
    return out


for path in sorted(root.rglob("*.rs")):
    if "target" in path.parts:
        continue
    if "tests" in path.parts:
        continue
    # Dedicated test module files co-located as src/tests.rs are entirely test.
    if path.name == "tests.rs":
        continue

    text = path.read_text(encoding="utf-8")
    for lineno, line in production_lines(text):
        # Ignore comments.
        code = line.split("//", 1)[0]
        if forbidden.search(code):
            rel = path.relative_to(root)
            violations.append(f"{rel}:{lineno}: {line.strip()}")

if violations:
    print("no-unwrap gate failed — production Rust must not use unwrap/expect/panic:", file=sys.stderr)
    for v in violations:
        print(f"  {v}", file=sys.stderr)
    sys.exit(1)

print("no-unwrap gate passed")
PY
