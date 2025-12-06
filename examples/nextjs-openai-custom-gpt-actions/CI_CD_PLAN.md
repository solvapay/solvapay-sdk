# Automated Deployment Plan for OpenAI Actions Example

This plan outlines the steps to configure automated deployment of the `nextjs-openai-custom-gpt-actions` example to Google Cloud Run whenever changes are pushed to the `dev` branch.

## 1. Quick Start

We have provided a script to automate the GCP resource setup:

```bash
./examples/nextjs-openai-custom-gpt-actions/scripts/setup-ci-cd.sh
```

This script will:
1. Create the `solvapay-examples` Artifact Registry repository.
2. Grant necessary IAM roles to the Cloud Build service account.
3. Create the Cloud Build trigger `deploy-openai-actions-dev`.

**After running the script, you must update the trigger with your actual environment variables in the GCP Console.**

## 2. Infrastructure Prerequisites

Ensure the following resources exist in the target GCP Project:

- **Artifact Registry Repository**:
  - Name: `solvapay-examples`
  - Format: Docker
  - Region: `europe-west2` (matches `cloudbuild-dev.yaml`)
  
- **APIs Enabled**:
  - Cloud Build API
  - Cloud Run API
  - Artifact Registry API

## 3. Service Account Permissions

The default Cloud Build Service Account (`<project-number>@cloudbuild.gserviceaccount.com`) needs the following IAM roles to deploy to Cloud Run:

- **Cloud Run Admin** (`roles/run.admin`): To deploy services.
- **Service Account User** (`roles/iam.serviceAccountUser`): To act as the runtime service account.
- **Artifact Registry Writer** (`roles/artifactregistry.writer`): To push images (usually granted by default).

## 4. Cloud Build Trigger Configuration

Create a new Cloud Build Trigger with the following settings:

- **Name**: `deploy-openai-actions-dev`
- **Region**: `europe-west2` (Recommended to match resources)
- **Event**: Push to a branch
- **Source**: Select the connected GitHub repository.
- **Branch**: `^dev$` (Regex for dev branch)
- **Included Files Filter** (Optional but recommended for monorepo):
  ```
  examples/nextjs-openai-custom-gpt-actions/**
  packages/**
  package.json
  pnpm-lock.yaml
  ```
- **Configuration**: Cloud Build configuration file (yaml or json)
- **Location**: `examples/nextjs-openai-custom-gpt-actions/cloudbuild-dev.yaml`

### Substitution Variables

The following substitution variables must be defined in the Trigger settings. These map to the variables used in `cloudbuild-dev.yaml`.

> **Note**: For sensitive values (Secrets), it is recommended to use Google Secret Manager, but the current configuration accepts them as substitutions.

**Build-time Variables (Frontend):**
- `_NEXT_PUBLIC_API_URL`: URL of the SolvaPay API (e.g. `https://api.solvapay.com`)
- `_NEXT_PUBLIC_AGENT_REF`: Your Agent Reference
- `_NEXT_PUBLIC_SUPABASE_URL`: Supabase URL
- `_NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase Anon Key
- `_NEXT_PUBLIC_GA_MEASUREMENT_ID`: Google Analytics ID (optional)

**Runtime Variables (Server):**
- `_SOLVAPAY_SECRET_KEY`: Your SolvaPay Secret Key
- `_SOLVAPAY_API_BASE_URL`: SolvaPay API Base URL
- `_SOLVAPAY_CLIENT_ID`: OAuth Client ID
- `_SOLVAPAY_CLIENT_SECRET`: OAuth Client Secret
- `_SOLVAPAY_AUTH_URL`: Auth URL
- `_SOLVAPAY_TOKEN_URL`: Token URL
- `_SOLVAPAY_USERINFO_URL`: User Info URL
- `_SUPABASE_JWT_SECRET`: Supabase JWT Secret
- `_SUPABASE_DB_URL`: Supabase Database URL
- `_SUPABASE_SERVICE_ROLE_KEY`: Supabase Service Role Key
- `_PUBLIC_URL`: Public URL of the deployed service (e.g. `https://openai-actions-dev-xyz.a.run.app`)

## 5. Verification

1.  Push a small change to the `dev` branch.
2.  Go to **Cloud Build > History** in GCP Console.
3.  Verify the build starts, succeeds, and the Cloud Run service `openai-actions-dev` is updated.
