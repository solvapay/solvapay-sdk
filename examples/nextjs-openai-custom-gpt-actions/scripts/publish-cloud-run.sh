#!/bin/bash

# Cloud Run Publish Script for Next.js OpenAI Custom GPT Actions Example
# Usage: ./scripts/publish-cloud-run.sh [--cloud-build] [project-id]
#   --cloud-build: Use Cloud Build instead of local Docker build (default: local build)
#   project-id: Optional project ID (auto-detected if not provided)
# Run from the example directory or from the repo root
#
# By default, this script builds the Docker image locally and pushes it to
# Artifact Registry, then deploys to Cloud Run. This avoids Cloud Build
# bucket permission issues.

set -e

# Parse arguments
BUILD_LOCAL=true  # Default to local builds
PROJECT_ID_ARG=""
for arg in "$@"; do
    case $arg in
        --cloud-build)
            BUILD_LOCAL=false
            shift
            ;;
        *)
            if [ -z "$PROJECT_ID_ARG" ] && [[ ! "$arg" =~ ^-- ]]; then
                PROJECT_ID_ARG="$arg"
            fi
            ;;
    esac
done

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the example directory (parent of scripts)
EXAMPLE_DIR="$(dirname "$SCRIPT_DIR")"
# Get the repo root (3 levels up from scripts)
REPO_ROOT="$(cd "$EXAMPLE_DIR/../.." && pwd)"

ENV_FILE="$EXAMPLE_DIR/.env.dev"

# Check if .env.dev exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Error: $ENV_FILE not found."
    echo "Please create it with the necessary variables (e.g. NEXT_PUBLIC_API_URL)."
    exit 1
fi

# Load variables from .env.dev
echo "📄 Loading environment variables from $ENV_FILE..."
# We export variables so they are available to the script
set -a
source "$ENV_FILE"
set +a

# Get Project ID from CLI session config, or use provided argument, or environment variable
if [ -n "$PROJECT_ID_ARG" ]; then
    # Project ID provided as argument (override)
    PROJECT_ID="$PROJECT_ID_ARG"
elif [ -n "$GOOGLE_CLOUD_PROJECT" ]; then
    # Use environment variable if set
    PROJECT_ID="$GOOGLE_CLOUD_PROJECT"
else
    # Get from gcloud CLI configuration
    echo "🔍 Detecting project ID from gcloud CLI configuration..."
    PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
    
    if [ -z "$PROJECT_ID" ]; then
        echo "❌ Error: Project ID is not set."
        echo "Please either:"
        echo "  1. Set it in gcloud: gcloud config set project YOUR_PROJECT_ID"
        echo "  2. Pass it as argument: ./scripts/publish-cloud-run.sh YOUR_PROJECT_ID"
        echo "  3. Set GOOGLE_CLOUD_PROJECT environment variable"
        exit 1
    fi
fi

# Check authentication status
echo "🔐 Checking gcloud authentication..."
ACTIVE_ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1)

if [ -z "$ACTIVE_ACCOUNT" ]; then
    echo "❌ Error: No active gcloud authentication found."
    echo ""
    echo "Please authenticate first using one of these methods:"
    echo "  1. User account: gcloud auth login"
    echo "  2. Application Default Credentials: gcloud auth application-default login"
    echo ""
    echo "After authenticating, run this script again."
    exit 1
fi

echo "✅ Authenticated as: $ACTIVE_ACCOUNT"

# Check and set up Application Default Credentials (ADC) - only needed for Cloud Build
if [ "$BUILD_LOCAL" = false ]; then
# gcloud builds submit uses ADC, not just gcloud auth
echo "🔍 Checking Application Default Credentials..."
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "⚠️  Application Default Credentials not found."
    echo "Setting up ADC using your current gcloud account..."
    echo "This may require your password once to set up ADC."
    gcloud auth application-default login --no-launch-browser
    echo "✅ Application Default Credentials configured"
else
    echo "✅ Application Default Credentials are configured"
fi

# Actively refresh credentials to avoid password prompts during build
echo "🔄 Refreshing credentials..."
# Try to refresh user credentials
gcloud auth list --filter=status:ACTIVE --format="value(account)" | while read account; do
    if [ -n "$account" ]; then
        echo "   Refreshing token for: $account"
        # This will refresh the token without prompting if it's still valid
        gcloud auth print-access-token --account="$account" >/dev/null 2>&1 || {
            echo "⚠️  Token expired for $account. Please run: gcloud auth login"
        }
    fi
done
fi

echo "🚀 Deploying to Google Cloud Project: $PROJECT_ID"
echo "📂 Repo root: $REPO_ROOT"
if [ "$BUILD_LOCAL" = false ]; then
    echo "📄 Using Cloud Build configuration from: $EXAMPLE_DIR/cloudbuild-dev.yaml"
fi

# Build substitution string from environment variables
# Cloud Build user-defined substitutions must start with underscore
# Format: _VAR1=value1,_VAR2=value2,...

SUBSTITUTIONS=""

# Helper function to add substitution if variable is set
add_substitution() {
    local var_name=$1
    local value=${!var_name}
    if [ -n "$value" ]; then
        if [ -n "$SUBSTITUTIONS" ]; then
            SUBSTITUTIONS="$SUBSTITUTIONS,"
        fi
        # Escape commas and equals in values (basic escaping)
        value=$(echo "$value" | sed 's/,/\\,/g' | sed 's/=/\\=/g')
        SUBSTITUTIONS="${SUBSTITUTIONS}_${var_name}=${value}"
    fi
}

# Add all environment variables as substitutions
echo "📦 Preparing build substitutions..."

# NEXT_PUBLIC_* variables (build-time, client-side)
add_substitution "NEXT_PUBLIC_API_URL"
add_substitution "NEXT_PUBLIC_AGENT_REF"
add_substitution "NEXT_PUBLIC_SUPABASE_URL"
add_substitution "NEXT_PUBLIC_SUPABASE_ANON_KEY"
add_substitution "NEXT_PUBLIC_GA_MEASUREMENT_ID"

# Server-side variables (runtime)
add_substitution "SOLVAPAY_SECRET_KEY"
add_substitution "SOLVAPAY_API_BASE_URL"
add_substitution "SOLVAPAY_CLIENT_ID"
add_substitution "SOLVAPAY_CLIENT_SECRET"
add_substitution "SOLVAPAY_AUTH_URL"
add_substitution "SOLVAPAY_TOKEN_URL"
add_substitution "SOLVAPAY_USERINFO_URL"
add_substitution "SUPABASE_JWT_SECRET"
add_substitution "SUPABASE_DB_URL"
add_substitution "SUPABASE_SERVICE_ROLE_KEY"
add_substitution "PUBLIC_URL"

if [ -z "$SUBSTITUTIONS" ]; then
    echo "⚠️  Warning: No environment variables found to pass as substitutions"
else
    echo "✅ Found environment variables to pass to build"
fi

# Configure Docker authentication for Artifact Registry (if needed)
echo "🐳 Configuring Docker authentication for Artifact Registry..."
gcloud auth configure-docker europe-west2-docker.pkg.dev --quiet 2>/dev/null || true

# Ensure the correct account is set as active and refresh it
echo "🔧 Activating and refreshing account..."
gcloud config set account "$ACTIVE_ACCOUNT" --quiet 2>/dev/null || true

# Get a fresh token to ensure credentials are valid
echo "🔑 Obtaining fresh access token..."
FRESH_TOKEN=$(gcloud auth print-access-token 2>&1)
if echo "$FRESH_TOKEN" | grep -q "ERROR\|Reauthentication required"; then
    echo "❌ Error: Your credentials have expired and need to be refreshed."
    echo "Please run: gcloud auth login"
    echo "Then run this script again."
    exit 1
fi

# Change to repo root for the build
cd "$REPO_ROOT"

# If building locally, skip Cloud Build
if [ "$BUILD_LOCAL" = true ]; then
    echo ""
    echo "🏗️  Building locally (skipping Cloud Build)..."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Generate a short SHA for tagging (use git commit if available, otherwise timestamp)
    if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
        SHORT_SHA=$(git rev-parse --short HEAD)
    else
        SHORT_SHA=$(date +%s | sha256sum | head -c 7)
    fi
    
    IMAGE_BASE="europe-west2-docker.pkg.dev/$PROJECT_ID/solvapay-examples/openai-actions"
    IMAGE_TAG_SHA="$IMAGE_BASE:dev-$SHORT_SHA"
    IMAGE_TAG_LATEST="$IMAGE_BASE:dev-latest"
    
    echo "📦 Image tags:"
    echo "   - $IMAGE_TAG_SHA"
    echo "   - $IMAGE_TAG_LATEST"
    echo ""
    
    # Build Docker image with all build arguments
    echo "🔨 Building Docker image..."
    DOCKER_BUILD_ARGS=(
        "build"
        "-t" "$IMAGE_TAG_SHA"
        "-t" "$IMAGE_TAG_LATEST"
        "-f" "$EXAMPLE_DIR/Dockerfile.cloudrun"
    )
    
    # Add build args for NEXT_PUBLIC_* variables
    [ -n "$NEXT_PUBLIC_API_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL")
    [ -n "$NEXT_PUBLIC_AGENT_REF" ] && DOCKER_BUILD_ARGS+=("--build-arg" "NEXT_PUBLIC_AGENT_REF=$NEXT_PUBLIC_AGENT_REF")
    [ -n "$NEXT_PUBLIC_SUPABASE_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL")
    [ -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ] && DOCKER_BUILD_ARGS+=("--build-arg" "NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY")
    [ -n "$NEXT_PUBLIC_GA_MEASUREMENT_ID" ] && DOCKER_BUILD_ARGS+=("--build-arg" "NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID")
    
    # Add build args for server-side variables
    [ -n "$SOLVAPAY_SECRET_KEY" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_SECRET_KEY=$SOLVAPAY_SECRET_KEY")
    [ -n "$SOLVAPAY_API_BASE_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_API_BASE_URL=$SOLVAPAY_API_BASE_URL")
    [ -n "$SOLVAPAY_CLIENT_ID" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_CLIENT_ID=$SOLVAPAY_CLIENT_ID")
    [ -n "$SOLVAPAY_CLIENT_SECRET" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_CLIENT_SECRET=$SOLVAPAY_CLIENT_SECRET")
    [ -n "$SOLVAPAY_AUTH_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_AUTH_URL=$SOLVAPAY_AUTH_URL")
    [ -n "$SOLVAPAY_TOKEN_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_TOKEN_URL=$SOLVAPAY_TOKEN_URL")
    [ -n "$SOLVAPAY_USERINFO_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SOLVAPAY_USERINFO_URL=$SOLVAPAY_USERINFO_URL")
    [ -n "$SUPABASE_JWT_SECRET" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET")
    [ -n "$SUPABASE_DB_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SUPABASE_DB_URL=$SUPABASE_DB_URL")
    [ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && DOCKER_BUILD_ARGS+=("--build-arg" "SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY")
    [ -n "$PUBLIC_URL" ] && DOCKER_BUILD_ARGS+=("--build-arg" "PUBLIC_URL=$PUBLIC_URL")
    
    DOCKER_BUILD_ARGS+=(".")
    
    if ! docker "${DOCKER_BUILD_ARGS[@]}"; then
        echo ""
        echo "❌ Docker build failed"
        exit 1
    fi
    
    echo ""
    echo "📤 Pushing images to Artifact Registry..."
    docker push "$IMAGE_TAG_SHA" || {
        echo "❌ Failed to push $IMAGE_TAG_SHA"
        exit 1
    }
    docker push "$IMAGE_TAG_LATEST" || {
        echo "❌ Failed to push $IMAGE_TAG_LATEST"
        exit 1
    }
    
    echo ""
    echo "🚀 Deploying to Cloud Run..."
    gcloud run deploy openai-actions-dev \
        --image="$IMAGE_TAG_LATEST" \
        --platform=managed \
        --region=europe-west2 \
        --project="$PROJECT_ID" \
        --cpu=1 \
        --memory=512Mi \
        --min-instances=0 \
        --max-instances=2 \
        --concurrency=80 \
        --timeout=60 \
        --allow-unauthenticated \
        --port=8080 || {
        echo ""
        echo "❌ Cloud Run deployment failed"
        exit 1
    }
    
    echo ""
    echo "✅ Local build and deployment completed successfully!"
    exit 0
fi

# Submit build to Cloud Build
# We use substitutions to pass the variables
echo "📤 Submitting build to Cloud Build..."
echo ""

# Run the build command and show output in real-time
# Capture exit code to check for errors
set +e  # Temporarily disable exit on error to capture exit code
if [ -n "$SUBSTITUTIONS" ]; then
    gcloud builds submit . \
        --config="$EXAMPLE_DIR/cloudbuild-dev.yaml" \
        --project="$PROJECT_ID" \
        --substitutions="$SUBSTITUTIONS" 2>&1 | tee /tmp/gcloud-build-output.log
    BUILD_EXIT_CODE=${PIPESTATUS[0]}
else
    gcloud builds submit . \
        --config="$EXAMPLE_DIR/cloudbuild-dev.yaml" \
        --project="$PROJECT_ID" 2>&1 | tee /tmp/gcloud-build-output.log
    BUILD_EXIT_CODE=${PIPESTATUS[0]}
fi
set -e  # Re-enable exit on error

# Check for errors and provide helpful messages
if [ $BUILD_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "❌ Build submission failed with exit code: $BUILD_EXIT_CODE"
    
    # Check if it's a bucket permission error
    if grep -q "forbidden from accessing the bucket" /tmp/gcloud-build-output.log 2>/dev/null; then
        echo ""
        echo "🔒 Cloud Build Bucket Permission Error Detected"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "You don't have permission to access the Cloud Build storage bucket."
        echo "This is a common issue when your account lacks the necessary IAM roles."
        echo ""
        echo "📋 SOLUTION OPTIONS:"
        echo ""
        echo "Option 1: Request Permissions (Recommended)"
        echo "  Ask your project administrator to grant you one of these roles:"
        echo "    • Cloud Build Editor (roles/cloudbuild.builds.editor)"
        echo "    • Storage Admin (roles/storage.admin) - for bucket access"
        echo "    • Or the specific permission: serviceusage.services.use"
        echo ""
        echo "  You can check your current roles with:"
        echo "    gcloud projects get-iam-policy $PROJECT_ID --flatten='bindings[].members' --filter='bindings.members:$(gcloud config get-value account)'"
        echo ""
        echo "Option 2: Use Cloud Source Repository"
        echo "  If your code is in a Cloud Source Repository, you can use:"
        echo "    gcloud builds submit --no-source --source=SOURCE_REPO_URL \\"
        echo "      --config=$EXAMPLE_DIR/cloudbuild-dev.yaml --project=$PROJECT_ID"
        echo ""
        echo "Option 3: Build Locally (Workaround)"
        echo "  Build and push the Docker image manually:"
        echo "    1. docker build -f $EXAMPLE_DIR/Dockerfile.cloudrun -t IMAGE_NAME ."
        echo "    2. docker push IMAGE_NAME"
        echo "    3. Deploy to Cloud Run using the pushed image"
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    else
    echo ""
    echo "Common issues:"
    echo "  • Permission errors: You may need 'serviceusage.services.use' permission or Viewer/Editor role"
    echo "  • Invalid configuration: Check your cloudbuild-dev.yaml file"
    echo "  • Network issues: Check your internet connection"
    echo ""
    echo "For permission issues, contact your project administrator."
    fi
    
    rm -f /tmp/gcloud-build-output.log
    exit $BUILD_EXIT_CODE
fi

rm -f /tmp/gcloud-build-output.log

echo ""
echo "✅ Deployment submitted successfully!"

