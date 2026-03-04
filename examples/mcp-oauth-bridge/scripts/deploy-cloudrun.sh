#!/usr/bin/env bash
# Deploy the MCP OAuth Bridge example to Google Cloud Run.
#
# Builds the Docker image from the monorepo root, pushes to Artifact Registry,
# and deploys a Cloud Run service with the specified configuration.
#
# Prerequisites:
#   - gcloud CLI authenticated with appropriate permissions
#   - Docker daemon running
#
# Example (two benchmark endpoints):
#
#   # Baseline (no paywall)
#   ./scripts/deploy-cloudrun.sh \
#     --project my-gcp-project \
#     --service mcp-benchmark-baseline \
#     --paywall false \
#     --secret-key "$SOLVAPAY_SECRET_KEY" \
#     --product-ref "$SOLVAPAY_PRODUCT_REF" \
#     --api-url https://api.example.com \
#     --oauth-url https://api.example.com
#
#   # SDK paywall
#   ./scripts/deploy-cloudrun.sh \
#     --project my-gcp-project \
#     --service mcp-benchmark-sdk \
#     --paywall true \
#     --secret-key "$SOLVAPAY_SECRET_KEY" \
#     --product-ref "$SOLVAPAY_PRODUCT_REF" \
#     --api-url https://api.example.com \
#     --oauth-url https://api.example.com

set -euo pipefail

REGION="europe-west2"
SERVICE="mcp-oauth-bridge"
PAYWALL="true"
TAG="latest"
PUBLIC_URL=""
REGISTRY_REPO="solvapay-examples"
IMAGE_NAME="mcp-oauth-bridge"

PROJECT=""
SECRET_KEY=""
PRODUCT_REF=""
API_URL=""
OAUTH_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)     PROJECT="$2"; shift 2 ;;
    --region)      REGION="$2"; shift 2 ;;
    --service)     SERVICE="$2"; shift 2 ;;
    --paywall)     PAYWALL="$2"; shift 2 ;;
    --tag)         TAG="$2"; shift 2 ;;
    --secret-key)  SECRET_KEY="$2"; shift 2 ;;
    --product-ref) PRODUCT_REF="$2"; shift 2 ;;
    --api-url)     API_URL="$2"; shift 2 ;;
    --oauth-url)   OAUTH_URL="$2"; shift 2 ;;
    --public-url)  PUBLIC_URL="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Required:"
      echo "  --project       GCP project ID"
      echo "  --secret-key    SolvaPay API secret key"
      echo "  --product-ref   SolvaPay product reference"
      echo "  --api-url       SolvaPay API base URL"
      echo "  --oauth-url     SolvaPay OAuth base URL"
      echo ""
      echo "Optional:"
      echo "  --region        GCP region (default: europe-west2)"
      echo "  --service       Cloud Run service name (default: mcp-oauth-bridge)"
      echo "  --paywall       Enable paywall: true|false (default: true)"
      echo "  --tag           Docker image tag (default: latest)"
      echo "  --public-url    Public base URL override (default: auto-detected from Cloud Run)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

for var in PROJECT SECRET_KEY PRODUCT_REF API_URL OAUTH_URL; do
  if [[ -z "${!var}" ]]; then
    echo "Error: --$(echo "$var" | tr '[:upper:]' '[:lower:]' | tr '_' '-') is required"
    exit 1
  fi
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCKERFILE="examples/mcp-oauth-bridge/Dockerfile"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT}/${REGISTRY_REPO}/${IMAGE_NAME}:${TAG}"

echo "==> Ensuring Artifact Registry repository exists..."
gcloud artifacts repositories create "$REGISTRY_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --project="$PROJECT" 2>/dev/null || true

echo "==> Configuring Docker authentication..."
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "==> Building Docker image..."
docker build \
  -t "$IMAGE_URI" \
  -f "$DOCKERFILE" \
  "$MONOREPO_ROOT"

echo "==> Pushing image to Artifact Registry..."
docker push "$IMAGE_URI"

echo "==> Deploying Cloud Run service: ${SERVICE}..."
gcloud run deploy "$SERVICE" \
  --image="$IMAGE_URI" \
  --region="$REGION" \
  --project="$PROJECT" \
  --platform=managed \
  --port=3004 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=1 \
  --max-instances=1 \
  --allow-unauthenticated \
  --set-env-vars="PAYWALL_ENABLED=${PAYWALL},MCP_HOST=0.0.0.0,MCP_PORT=3004,SOLVAPAY_SECRET_KEY=${SECRET_KEY},SOLVAPAY_PRODUCT_REF=${PRODUCT_REF},SOLVAPAY_API_BASE_URL=${API_URL},SOLVAPAY_OAUTH_BASE_URL=${OAUTH_URL}"

SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --format='value(status.url)')

if [[ -n "$PUBLIC_URL" ]]; then
  ACTUAL_PUBLIC_URL="$PUBLIC_URL"
else
  ACTUAL_PUBLIC_URL="$SERVICE_URL"
fi

echo "==> Updating MCP_PUBLIC_BASE_URL to ${ACTUAL_PUBLIC_URL}..."
gcloud run services update "$SERVICE" \
  --region="$REGION" \
  --project="$PROJECT" \
  --update-env-vars="MCP_PUBLIC_BASE_URL=${ACTUAL_PUBLIC_URL}"

echo ""
echo "Deployed successfully!"
echo "  Service: ${SERVICE}"
echo "  URL:     ${SERVICE_URL}"
echo "  Paywall: ${PAYWALL}"
