#!/bin/bash
set -e

# Configuration
PROJECT_ID=$(gcloud config get-value project)
REGION="europe-west2"
REPO_NAME="solvapay-examples"

echo "🚀 Setting up CI/CD for project: $PROJECT_ID"

# 1. Create Artifact Registry Repository
echo "📦 Checking Artifact Registry..."
if ! gcloud artifacts repositories describe $REPO_NAME --location=$REGION --project=$PROJECT_ID >/dev/null 2>&1; then
    echo "Creating repository $REPO_NAME in $REGION..."
    gcloud artifacts repositories create $REPO_NAME \
        --repository-format=docker \
        --location=$REGION \
        --description="Docker repository for SolvaPay examples" \
        --project=$PROJECT_ID
else
    echo "✅ Repository $REPO_NAME already exists."
fi

# 2. Grant IAM Permissions to Cloud Build Service Account
echo "🔐 Configuring IAM permissions..."
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
CB_SA="$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"

echo "Granting Cloud Run Admin role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$CB_SA" \
    --role="roles/run.admin" >/dev/null

echo "Granting Service Account User role..."
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$CB_SA" \
    --role="roles/iam.serviceAccountUser" >/dev/null

echo "✅ IAM permissions granted."

echo ""
echo "⚠️  NOTE: Automatic trigger creation via CLI is currently failing."
echo "Please create the trigger manually in the Google Cloud Console:"
echo "https://console.cloud.google.com/cloud-build/triggers/add?project=$PROJECT_ID"
echo ""
echo "Use these settings:"
echo "  • Name: deploy-openai-actions-dev"
echo "  • Region: $REGION"
echo "  • Event: Push to a branch"
echo "  • Source: Select your 'solvapay-sdk' repository"
echo "  • Branch: ^dev$"
echo "  • Configuration: Cloud Build configuration file (yaml or json)"
echo "  • Location: examples/nextjs-openai-custom-gpt-actions/cloudbuild-dev.yaml"
echo ""
echo "And add these substitution variables:"
echo "  • _NEXT_PUBLIC_API_URL"
echo "  • _NEXT_PUBLIC_AGENT_REF"
echo "  • _NEXT_PUBLIC_SUPABASE_URL"
echo "  • _NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "  • ... (see CI_CD_PLAN.md for full list)"
