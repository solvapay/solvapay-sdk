#!/bin/bash

# Script to set up a Next.js project with SolvaPay and Supabase
# Distributed via npx create-solvapay-app

# Get the directory where this script is located, resolving symlinks
# This handles the case where npx creates a symlink in node_modules/.bin/
SCRIPT_SOURCE="${BASH_SOURCE[0]}"

# Resolve symlinks iteratively to find the actual script location
# This works on both macOS and Linux
RESOLVED_SCRIPT="$SCRIPT_SOURCE"
while [ -L "$RESOLVED_SCRIPT" ]; do
    TARGET="$(readlink "$RESOLVED_SCRIPT")"
    if [[ "$TARGET" = /* ]]; then
        # Absolute symlink
        RESOLVED_SCRIPT="$TARGET"
    else
        # Relative symlink - resolve relative to the symlink's directory
        RESOLVED_SCRIPT="$(cd "$(dirname "$RESOLVED_SCRIPT")" && pwd)/$TARGET"
    fi
done

# Get the directory of the resolved script
SCRIPT_DIR="$(cd "$(dirname "$RESOLVED_SCRIPT")" && pwd)"

# Find the package root by looking for the guides directory
# Walk up from the script directory until we find the package root
PACKAGE_ROOT="$SCRIPT_DIR"
while [ "$PACKAGE_ROOT" != "/" ]; do
    # Check if this directory contains the guides folder (indicating package root)
    if [ -d "$PACKAGE_ROOT/guides" ]; then
        break
    fi
    PACKAGE_ROOT="$(dirname "$PACKAGE_ROOT")"
done

# Set guides directory relative to package root
GUIDES_DIR="$PACKAGE_ROOT/guides"

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
if [ -d "$GUIDES_DIR" ]; then
    for file in "$GUIDES_DIR"/*.md; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cp "$file" "./guides/$filename"
            echo "  - Copied $filename"
        fi
    done
    echo "Guide files copied successfully to guides folder"
else
    echo "Warning: Guides directory not found at $GUIDES_DIR"
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

