#!/bin/bash

# Script to set up a Next.js project with SolvaPay and Supabase
# Distributed via npx create-solvapay-app

# Get the directory where this script is located, resolving symlinks
# This handles the case where npx creates a symlink in node_modules/.bin/
SCRIPT_SOURCE="${BASH_SOURCE[0]}"

# Resolve symlinks iteratively to find the actual script location
# This works on both macOS and Linux
RESOLVED_SCRIPT="$SCRIPT_SOURCE"
# Limit iterations to prevent infinite loops
ITERATIONS=0
MAX_ITERATIONS=20
while [ -L "$RESOLVED_SCRIPT" ] && [ $ITERATIONS -lt $MAX_ITERATIONS ]; do
    TARGET="$(readlink "$RESOLVED_SCRIPT")"
    if [[ "$TARGET" = /* ]]; then
        # Absolute symlink
        RESOLVED_SCRIPT="$TARGET"
    else
        # Relative symlink - resolve relative to the symlink's directory
        SYMLINK_DIR="$(cd "$(dirname "$RESOLVED_SCRIPT")" 2>/dev/null && pwd)"
        if [ -n "$SYMLINK_DIR" ]; then
            RESOLVED_SCRIPT="$SYMLINK_DIR/$TARGET"
        else
            # If cd fails, break the loop
            break
        fi
    fi
    ITERATIONS=$((ITERATIONS + 1))
done

# Get the directory of the resolved script
SCRIPT_DIR="$(cd "$(dirname "$RESOLVED_SCRIPT")" 2>/dev/null && pwd)"
if [ -z "$SCRIPT_DIR" ]; then
    # Fallback: use the original script source directory
    SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" 2>/dev/null && pwd)"
fi

# Find the package root by looking for the guides directory or package.json
# Walk up from the script directory until we find the package root
PACKAGE_ROOT="$SCRIPT_DIR"
GUIDES_DIR=""

# Method 1: Try to use Node.js to find the package location (most reliable for npm/npx)
if command -v node &> /dev/null; then
    # Use Node.js to resolve the package location
    # Pass the resolved script path as an environment variable to avoid argv issues
    export RESOLVED_SCRIPT_PATH="$RESOLVED_SCRIPT"
    NODE_PACKAGE_DIR=$(node -e "
        try {
            const path = require('path');
            const fs = require('fs');
            // Get the script path from environment variable
            const scriptPath = process.env.RESOLVED_SCRIPT_PATH;
            if (!scriptPath) return;
            let currentDir = path.dirname(scriptPath);
            // Walk up to find node_modules
            for (let i = 0; i < 10; i++) {
                const nodeModulesPath = path.join(currentDir, 'node_modules', 'create-solvapay-app');
                if (fs.existsSync(nodeModulesPath)) {
                    const guidesPath = path.join(nodeModulesPath, 'guides');
                    if (fs.existsSync(guidesPath)) {
                        console.log(guidesPath);
                        process.exit(0);
                    }
                }
                // Also check if we're already in the package directory
                const packageJsonPath = path.join(currentDir, 'package.json');
                if (fs.existsSync(packageJsonPath)) {
                    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                    if (pkg.name === 'create-solvapay-app') {
                        const guidesPath = path.join(currentDir, 'guides');
                        if (fs.existsSync(guidesPath)) {
                            console.log(guidesPath);
                            process.exit(0);
                        }
                    }
                }
                const parentDir = path.dirname(currentDir);
                if (parentDir === currentDir) break;
                currentDir = parentDir;
            }
        } catch (e) {
            // Ignore errors
        }
    " 2>/dev/null)
    unset RESOLVED_SCRIPT_PATH
    
    if [ -n "$NODE_PACKAGE_DIR" ] && [ -d "$NODE_PACKAGE_DIR" ]; then
        GUIDES_DIR="$(cd "$NODE_PACKAGE_DIR" 2>/dev/null && pwd)"
    fi
fi

# Method 2: Check if guides is in the parent directory (common case: script in bin/)
# This handles both local development and npm installation
if [ -z "$GUIDES_DIR" ] || [ ! -d "$GUIDES_DIR" ]; then
    if [ -d "$SCRIPT_DIR/../guides" ]; then
        GUIDES_DIR="$(cd "$SCRIPT_DIR/../guides" 2>/dev/null && pwd)"
    fi
fi

# Method 3: Walk up the directory tree to find the package root
if [ -z "$GUIDES_DIR" ] || [ ! -d "$GUIDES_DIR" ]; then
    CURRENT_DIR="$SCRIPT_DIR"
    MAX_WALK_UP=10
    WALK_COUNT=0
    while [ "$CURRENT_DIR" != "/" ] && [ $WALK_COUNT -lt $MAX_WALK_UP ]; do
        # Check if this directory contains both package.json and guides folder
        if [ -f "$CURRENT_DIR/package.json" ]; then
            # Check if this is the create-solvapay-app package
            if grep -q '"name":\s*"create-solvapay-app"' "$CURRENT_DIR/package.json" 2>/dev/null; then
                if [ -d "$CURRENT_DIR/guides" ]; then
                    GUIDES_DIR="$(cd "$CURRENT_DIR/guides" 2>/dev/null && pwd)"
                    break
                fi
            fi
        fi
        # Also check if guides exists at this level
        if [ -d "$CURRENT_DIR/guides" ]; then
            # Verify it's not empty and has markdown files
            if [ -n "$(ls -A "$CURRENT_DIR/guides"/*.md 2>/dev/null)" ]; then
                GUIDES_DIR="$(cd "$CURRENT_DIR/guides" 2>/dev/null && pwd)"
                break
            fi
        fi
        CURRENT_DIR="$(dirname "$CURRENT_DIR")"
        WALK_COUNT=$((WALK_COUNT + 1))
    done
fi

# Method 4: Check if guides is in the same directory as the script
if [ -z "$GUIDES_DIR" ] || [ ! -d "$GUIDES_DIR" ]; then
    if [ -d "$SCRIPT_DIR/guides" ]; then
        GUIDES_DIR="$(cd "$SCRIPT_DIR/guides" 2>/dev/null && pwd)"
    fi
fi

# Method 5: Try to find node_modules/create-solvapay-app/guides relative to script location
if [ -z "$GUIDES_DIR" ] || [ ! -d "$GUIDES_DIR" ]; then
    CURRENT_DIR="$SCRIPT_DIR"
    MAX_WALK_UP=10
    WALK_COUNT=0
    while [ "$CURRENT_DIR" != "/" ] && [ $WALK_COUNT -lt $MAX_WALK_UP ]; do
        # Look for node_modules/create-solvapay-app/guides
        if [ -d "$CURRENT_DIR/node_modules/create-solvapay-app/guides" ]; then
            GUIDES_DIR="$(cd "$CURRENT_DIR/node_modules/create-solvapay-app/guides" 2>/dev/null && pwd)"
            break
        fi
        CURRENT_DIR="$(dirname "$CURRENT_DIR")"
        WALK_COUNT=$((WALK_COUNT + 1))
    done
fi

# Get project name from argument or prompt
if [ -n "$1" ]; then
    PROJECT_NAME="$1"
else
    read -p "Enter project name: " PROJECT_NAME
fi

if [ -z "$PROJECT_NAME" ]; then
    echo "Error: Project name cannot be empty"
    exit 1
fi

# Check if directory already exists
if [ -d "$PROJECT_NAME" ]; then
    echo "Error: Directory '$PROJECT_NAME' already exists"
    exit 1
fi

echo "Creating Next.js project: $PROJECT_NAME"
echo ""

# Initialize Next.js Project
npx create-next-app@latest "$PROJECT_NAME" --typescript --eslint --tailwind --app --import-alias "@/*" --yes

# Check if create-next-app was successful
if [ $? -ne 0 ]; then
    echo "Error: Failed to create Next.js project"
    exit 1
fi

# Change into project directory
cd "$PROJECT_NAME" || exit 1

# Detect package manager based on lock files created by create-next-app
# or which package managers are available
if [ -f "pnpm-lock.yaml" ]; then
    PACKAGE_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
    PACKAGE_MANAGER="yarn"
elif command -v pnpm &> /dev/null; then
    # Prefer pnpm if available but no lock file yet
    PACKAGE_MANAGER="pnpm"
elif command -v yarn &> /dev/null; then
    PACKAGE_MANAGER="yarn"
else
    PACKAGE_MANAGER="npm"
fi

echo ""
echo "Detected package manager: $PACKAGE_MANAGER"
echo "Installing dependencies..."

# Install Dependencies using detected package manager
if [ "$PACKAGE_MANAGER" = "pnpm" ]; then
    pnpm add @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @solvapay/react-supabase@preview @supabase/supabase-js
elif [ "$PACKAGE_MANAGER" = "yarn" ]; then
    yarn add @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @solvapay/react-supabase@preview @supabase/supabase-js
else
    npm install @solvapay/auth@preview @solvapay/server@preview @solvapay/next@preview @solvapay/react@preview @solvapay/react-supabase@preview @supabase/supabase-js
fi

if [ $? -ne 0 ]; then
    echo "Error: Failed to install dependencies"
    exit 1
fi

echo ""
echo "Creating .env.local file..."

# Create .env.local file
cat > .env.local << 'EOF'
# SolvaPay Configuration
SOLVAPAY_SECRET_KEY=sp_sandbox_your_secret_key_here
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com
NEXT_PUBLIC_AGENT_REF=agt_your_agent_ref

# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_JWT_SECRET=your_supabase_jwt_secret_here
EOF

echo ".env.local file created successfully"

# Check if src folder exists, if not create it and move app folder
if [ ! -d "src" ] && [ -d "app" ]; then
    echo ""
    echo "Creating src folder and moving app directory..."
    mkdir src
    mv app src/
    echo "src folder structure created"
fi

# Copy guide files to guides folder
echo ""
echo "Copying guide files to guides folder..."

# Create guides directory if it doesn't exist
mkdir -p guides

# Copy all markdown files from the guides directory
if [ -n "$GUIDES_DIR" ] && [ -d "$GUIDES_DIR" ]; then
    COPIED_COUNT=0
    for file in "$GUIDES_DIR"/*.md; do
        # Check if file exists (handles case where no .md files match the glob)
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "./guides/$filename"
            echo "  - Copied $filename"
            COPIED_COUNT=$((COPIED_COUNT + 1))
        fi
    done
    if [ "$COPIED_COUNT" -gt 0 ]; then
        echo "Guide files copied successfully to guides folder"
    else
        echo "Warning: No markdown files found in $GUIDES_DIR"
    fi
else
    echo "Warning: Guides directory not found"
    echo "  Script location: $SCRIPT_DIR"
    echo "  Resolved script path: $RESOLVED_SCRIPT"
    echo "  Expected guides location: $GUIDES_DIR"
    echo "  Attempted paths:"
    echo "    - $SCRIPT_DIR/../guides"
    echo "    - $SCRIPT_DIR/guides"
    # Try to find where the package might actually be
    if [ -f "$SCRIPT_DIR/../package.json" ]; then
        echo "  Found package.json at: $SCRIPT_DIR/../package.json"
        if [ -d "$SCRIPT_DIR/../guides" ]; then
            echo "  Guides directory exists at: $SCRIPT_DIR/../guides"
        fi
    fi
    echo "  Please check that the create-solvapay-app package is properly installed"
fi

# Store the project directory path for opening with Cursor
PROJECT_DIR="$(pwd)"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update .env.local with your actual credentials"
echo "2. Run '$PACKAGE_MANAGER run dev' to start the development server"
echo "3. Visit http://localhost:3000 to verify installation"
echo ""
echo "Project directory: $PROJECT_DIR"

# Open project in Cursor (if available)
echo ""
if command -v cursor &> /dev/null; then
    echo "Opening project in Cursor..."
    cursor "$PROJECT_DIR"
elif command -v code &> /dev/null; then
    echo "Opening project in VS Code..."
    code "$PROJECT_DIR"
else
    echo "To open in your editor, run: cd $PROJECT_DIR"
fi

