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


def strip_rust_literals(text: str) -> str:
    """Replace string/char/byte/raw/c-string literal bodies with spaces.

    Keeps length stable so brace depth tracking stays aligned with the source
    while braces inside emitter test fixtures (embedded generated code) do not
    close a #[cfg(test)] module early.
    """
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]

        # Line comments
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            if j < 0:
                out.append(" " * (n - i))
                break
            out.append(" " * (j - i))
            out.append("\n")
            i = j + 1
            continue

        # Block comments
        if ch == "/" and i + 1 < n and text[i + 1] == "*":
            j = text.find("*/", i + 2)
            if j < 0:
                out.append(" " * (n - i))
                break
            end = j + 2
            chunk = text[i:end]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = end
            continue

        # Raw strings: r#"..."#, br#"..."#, cr#"..."#, etc.
        raw = re.match(r'(?i)[cb]?r(#*)"', text[i:])
        if raw:
            hashes = raw.group(1)
            start = i + raw.end()
            closer = '"' + hashes
            j = text.find(closer, start)
            if j < 0:
                out.append(" " * (n - i))
                break
            end = j + len(closer)
            chunk = text[i:end]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = end
            continue

        # Ordinary / byte / c strings: "...", b"...", c"..."
        ordinary = re.match(r'(?i)[cb]?"', text[i:])
        if ordinary:
            j = i + ordinary.end()
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == '"':
                    j += 1
                    break
                j += 1
            chunk = text[i:j]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = j
            continue

        # Char literals: 'x', b'x', '\n', etc. Avoid lifetimes ('a) and labels.
        if ch in "bB" and i + 1 < n and text[i + 1] == "'":
            prefix_len = 1
            quote_at = i + 1
        elif ch == "'":
            prefix_len = 0
            quote_at = i
        else:
            out.append(ch)
            i += 1
            continue

        # Lifetime / label: 'ident — not a char literal unless closed as 'x'.
        after = quote_at + 1
        if after < n and (text[after].isalpha() or text[after] == "_"):
            k = after + 1
            while k < n and (text[k].isalnum() or text[k] == "_"):
                k += 1
            if k >= n or text[k] != "'":
                out.append(text[i:k])
                i = k
                continue

        j = quote_at + 1
        while j < n:
            if text[j] == "\\":
                j += 2
                continue
            if text[j] == "'":
                j += 1
                break
            j += 1
        chunk = text[i:j]
        out.append("".join("\n" if c == "\n" else " " for c in chunk))
        i = j

    return "".join(out)


def production_lines(text: str) -> list[tuple[int, str]]:
    """Yield (1-based line no, line) outside #[cfg(test)] modules/fns."""
    # Brace depth must ignore braces inside string/char literals — emitter tests
    # embed generated Rust/Ruby/etc. with unmatched-looking braces.
    scrubbed_lines = strip_rust_literals(text).splitlines()
    lines = text.splitlines()
    out: list[tuple[int, str]] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if cfg_test_start.search(line):
            # Skip attribute + following item (mod/fn) including its body.
            # Allow other attributes (including multi-line #[allow(...)]) between
            # cfg(test) and the item.
            j = i + 1
            while j < len(lines):
                stripped = lines[j].strip()
                if stripped == "" or stripped.startswith("//"):
                    j += 1
                    continue
                if stripped.startswith("#["):
                    depth = scrubbed_lines[j].count("[") - scrubbed_lines[j].count("]")
                    j += 1
                    while depth > 0 and j < len(lines):
                        depth += scrubbed_lines[j].count("[") - scrubbed_lines[j].count("]")
                        j += 1
                    continue
                break
            if j < len(lines) and mod_or_fn.search(lines[j]):
                # Find opening brace on this or following lines.
                k = j
                while k < len(lines) and "{" not in scrubbed_lines[k]:
                    k += 1
                if k >= len(lines):
                    break
                depth = 0
                started = False
                while k < len(lines):
                    for ch in scrubbed_lines[k]:
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
        # Ignore comments and string/char literal bodies.
        code = strip_rust_literals(line)
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
