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
#     --service mcp-benchmark-baseline \
#     --paywall false
#
#   # SDK paywall (requires SolvaPay credentials)
#   # First, store the secret key in Secret Manager:
#   #   echo -n "$SOLVAPAY_SECRET_KEY" | gcloud secrets create solvapay-secret-key --data-file=-
#   ./scripts/deploy-cloudrun.sh \
#     --service mcp-benchmark-sdk \
#     --paywall true \
#     --secret-name solvapay-secret-key \
#     --product-ref "$SOLVAPAY_PRODUCT_REF" \
#     --api-url https://api.solvapay.com

set -euo pipefail

REGION="europe-west2"
SERVICE="mcp-oauth-bridge"
PAYWALL="true"
TAG="latest"
PUBLIC_URL=""
REGISTRY_REPO="solvapay-examples"
IMAGE_NAME="mcp-oauth-bridge"

PROJECT="${GCLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
SECRET_KEY=""
SECRET_NAME=""
PRODUCT_REF=""
API_URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)     PROJECT="$2"; shift 2 ;;
    --region)      REGION="$2"; shift 2 ;;
    --service)     SERVICE="$2"; shift 2 ;;
    --paywall)     PAYWALL="$2"; shift 2 ;;
    --tag)         TAG="$2"; shift 2 ;;
    --secret-key)  SECRET_KEY="$2"; shift 2 ;;
    --secret-name) SECRET_NAME="$2"; shift 2 ;;
    --product-ref) PRODUCT_REF="$2"; shift 2 ;;
    --api-url)     API_URL="$2"; shift 2 ;;
    --public-url)  PUBLIC_URL="$2"; shift 2 ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Required when --paywall true (default):"
      echo "  --secret-name   Secret Manager secret name for SolvaPay API key (recommended)"
      echo "  --secret-key    SolvaPay API secret key as plain text (alternative to --secret-name)"
      echo "  --product-ref   SolvaPay product reference"
      echo "  --api-url       SolvaPay API base URL"
      echo ""
      echo "Optional:"
      echo "  --project       GCP project ID (default: gcloud config project)"
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

if [[ -z "$PROJECT" ]]; then
  echo "Error: --project is required (or set a default via gcloud config set project)"
  exit 1
fi

if [[ "$PAYWALL" == "true" ]]; then
  if [[ -z "$SECRET_KEY" && -z "$SECRET_NAME" ]]; then
    echo "Error: --secret-name or --secret-key is required when --paywall true"
    exit 1
  fi
  for var in PRODUCT_REF API_URL; do
    if [[ -z "${!var}" ]]; then
      echo "Error: --$(echo "$var" | tr '[:upper:]' '[:lower:]' | tr '_' '-') is required when --paywall true"
      exit 1
    fi
  done
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCKERFILE="${MONOREPO_ROOT}/examples/mcp-oauth-bridge/Dockerfile"
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
  --platform linux/amd64 \
  -t "$IMAGE_URI" \
  -f "$DOCKERFILE" \
  "$MONOREPO_ROOT"

echo "==> Pushing image to Artifact Registry..."
docker push "$IMAGE_URI"

ENV_VARS="PAYWALL_ENABLED=${PAYWALL},MCP_HOST=0.0.0.0,MCP_PORT=3004"
SECRETS_FLAG=""

if [[ -n "$SECRET_NAME" ]]; then
  ENV_VARS="${ENV_VARS},SOLVAPAY_PRODUCT_REF=${PRODUCT_REF},SOLVAPAY_API_BASE_URL=${API_URL}"
  SECRETS_FLAG="--set-secrets=SOLVAPAY_SECRET_KEY=${SECRET_NAME}:latest"
elif [[ -n "$SECRET_KEY" ]]; then
  ENV_VARS="${ENV_VARS},SOLVAPAY_SECRET_KEY=${SECRET_KEY},SOLVAPAY_PRODUCT_REF=${PRODUCT_REF},SOLVAPAY_API_BASE_URL=${API_URL}"
fi

echo "==> Deploying Cloud Run service: ${SERVICE}..."
# shellcheck disable=SC2086
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
  --set-env-vars="$ENV_VARS" \
  $SECRETS_FLAG

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
