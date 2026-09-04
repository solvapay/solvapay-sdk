#!/usr/bin/env bash
# Rewrite the split Go module onto the rehearsal module path.
# Run from the subtree-split root (go.mod at .). Does not touch global git config.
set -euo pipefail

COMMIT=true
if [[ "${1:-}" == "--no-commit" ]]; then
  COMMIT=false
fi

if [[ ! -f go.mod ]]; then
  echo "rehearsal-retarget: go.mod missing — run from the subtree-split root" >&2
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
import re

pat = re.compile(r"github\.com/solvapay/solvapay-go(?!-rehearsal)")
for path in Path(".").rglob("*"):
    if ".git" in path.parts or not path.is_file():
        continue
    if path.suffix != ".go" and path.name not in {"go.mod", "go.sum"}:
        continue
    text = path.read_text()
    rewritten = pat.sub("github.com/solvapay/solvapay-go-rehearsal", text)
    if rewritten != text:
        path.write_text(rewritten)
PY

if [[ "$COMMIT" == true ]]; then
  git add -A
  git -c user.name=solvapay-rehearsal \
    -c user.email=solvapay-rehearsal@users.noreply.github.com \
    commit -m "rehearsal: retarget module path"
fi
