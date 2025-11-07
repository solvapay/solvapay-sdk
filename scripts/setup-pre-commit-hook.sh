#!/bin/bash
# Setup pre-commit hook for documentation link validation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_DIR="$REPO_ROOT/.husky"

echo "🔧 Setting up pre-commit hook for documentation link validation..."

# Check if husky is installed
if ! command -v husky &> /dev/null && [ ! -d "$HOOK_DIR" ]; then
  echo "📦 Installing husky..."
  cd "$REPO_ROOT"
  pnpm add -D husky
  pnpm exec husky init || true
fi

# Create .husky directory if it doesn't exist
mkdir -p "$HOOK_DIR"

# Create or update pre-commit hook
HOOK_FILE="$HOOK_DIR/pre-commit"

if [ -f "$HOOK_FILE" ]; then
  echo "⚠️  Pre-commit hook already exists. Checking if link validation is included..."
  
  if grep -q "docs:validate-links" "$HOOK_FILE"; then
    echo "✅ Link validation already in pre-commit hook"
    exit 0
  else
    echo "➕ Adding link validation to existing pre-commit hook..."
    echo "" >> "$HOOK_FILE"
    echo "# Validate documentation links" >> "$HOOK_FILE"
    echo "pnpm docs:validate-links" >> "$HOOK_FILE"
  fi
else
  echo "📝 Creating new pre-commit hook..."
  cat > "$HOOK_FILE" << 'EOF'
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Validate documentation links
pnpm docs:validate-links
EOF
  chmod +x "$HOOK_FILE"
fi

echo "✅ Pre-commit hook setup complete!"
echo ""
echo "The hook will now run 'pnpm docs:validate-links' before each commit."
echo "To test it, try making a commit with a broken link in docs/"

