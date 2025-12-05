# Next.js Deployment Configuration Guide

This guide explains how to configure a Next.js project for deployment using Google Cloud Build and Cloud Run, following the same pattern as the SolvaPay frontend project.

## Overview

The deployment setup uses:
- **Google Cloud Build** for CI/CD automation
- **Google Cloud Run** for containerized hosting
- **Artifact Registry** for Docker image storage
- **Multi-stage Docker builds** for optimized production images

## Prerequisites

1. Google Cloud Project with billing enabled
2. Google Cloud SDK (`gcloud`) installed and authenticated
3. Artifact Registry repository created
4. Cloud Build API enabled
5. Cloud Run API enabled

## Project Structure

Your Next.js project should have the following files:

```
your-nextjs-project/
├── Dockerfile.cloudrun          # Multi-stage Docker build
├── cloudbuild-dev.yaml          # Development environment config
├── cloudbuild-staging.yaml      # Staging environment config
├── cloudbuild-prod.yaml         # Production environment config
├── next.config.js               # Next.js configuration
├── package.json                 # Dependencies and scripts
└── .env.local                   # Local environment variables (gitignored)
```

## Step 1: Configure Next.js for Standalone Output

Update your `next.config.js` to support standalone builds for Docker deployment:

```javascript
/** @type {import('next').NextConfig} */
const enableStandaloneOutput = process.env.NEXT_STANDALONE_OUTPUT === "1"
const nextConfig = {
  // Enable standalone output for Docker/Cloud Run deployments
  ...(enableStandaloneOutput ? { output: "standalone" } : {}),
  
  // Your existing Next.js configuration
  // ... other config options
}

module.exports = nextConfig
```

**Important Notes:**
- Standalone builds are only used for Docker/Cloud Run deployments
- They can break local image optimization, so we gate it behind an env flag
- For local development, standalone mode is disabled

## Step 2: Create Dockerfile.cloudrun

Create a multi-stage Dockerfile optimized for Cloud Run:

```dockerfile
# Multi-stage Dockerfile for Next.js on Cloud Run
# Standard build without standalone mode

# Stage 1: Dependencies
FROM node:18-alpine AS deps
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Builder
FROM node:18-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=$NEXT_PUBLIC_GA_MEASUREMENT_ID
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_STANDALONE_OUTPUT=1

# Build the application
RUN npm run build

# Stage 3: Runner
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone build
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Copy static files
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy public folder
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

# Expose port 8080 for Cloud Run
EXPOSE 8080

ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Start the Next.js standalone server
CMD ["node", "server.js"]
```

**Key Points:**
- Uses Node.js 18 Alpine for smaller image size
- Multi-stage build reduces final image size
- Runs as non-root user for security
- Port 8080 is required for Cloud Run

## Step 3: Create Cloud Build Configuration Files

### Development Environment (cloudbuild-dev.yaml)

```yaml
# Cloud Build Configuration for Frontend Development Environment
# Triggered on: Git push to dev branch
# Deploys to: your-project-dev Cloud Run service

steps:
  # Step 1: Build the Docker image
  - name: 'gcr.io/cloud-builders/docker'
    id: 'build-image'
    args:
      - 'build'
      - '-t'
      - 'europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service:dev-$SHORT_SHA'
      - '-t'
      - 'europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service:dev-latest'
      - '-f'
      - 'Dockerfile.cloudrun'
      - '--build-arg'
      - 'NEXT_PUBLIC_API_URL=https://api-dev.yourdomain.com/v1'
      - '--build-arg'
      - 'NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX'
      - '.'
    timeout: '900s'

  # Step 2: Push the Docker image to Artifact Registry
  - name: 'gcr.io/cloud-builders/docker'
    id: 'push-image'
    args:
      - 'push'
      - '--all-tags'
      - 'europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service'
    waitFor: ['build-image']

  # Step 3: Deploy to Cloud Run (Development)
  - name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
    id: 'deploy-cloudrun'
    entrypoint: 'gcloud'
    args:
      - 'run'
      - 'deploy'
      - 'your-project-dev'
      - '--image=europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service:dev-latest'
      - '--platform=managed'
      - '--region=europe-west2'
      - '--cpu=1'
      - '--memory=512Mi'
      - '--min-instances=0'
      - '--max-instances=2'
      - '--concurrency=80'
      - '--timeout=60'
      - '--allow-unauthenticated'
      - '--port=8080'
    waitFor: ['push-image']

# Images to be pushed to Artifact Registry
images:
  - 'europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service:dev-$SHORT_SHA'
  - 'europe-west2-docker.pkg.dev/$PROJECT_ID/your-repo-name/your-service:dev-latest'

# Build configuration
options:
  machineType: 'E2_HIGHCPU_8'
  logging: CLOUD_LOGGING_ONLY
  
timeout: '1200s'

# Tags for filtering builds
tags: ['dev', 'frontend', 'development']
```

### Staging Environment (cloudbuild-staging.yaml)

Similar to dev, but with:
- Different image tags (`staging-$SHORT_SHA`, `staging-latest`)
- Different API URL (`api-staging.yourdomain.com`)
- Different service name (`your-project-staging`)
- Slightly higher resources (1Gi memory, 3 max instances)
- Uses specific SHA tag instead of `latest` for deployment

### Production Environment (cloudbuild-prod.yaml)

Similar to staging, but with:
- Production API URL (`api.yourdomain.com`)
- Production service name (`your-project`)
- Higher resources (2 CPU, 2Gi memory, 10 max instances)
- Minimum 1 instance (always-on)
- Multiple image tags including `latest` and `prod-latest`

## Step 4: Customize Configuration Values

Replace the following placeholders in your Cloud Build files:

| Placeholder | Description | Example |
|------------|-------------|---------|
| `$PROJECT_ID` | Your GCP Project ID | `my-gcp-project` |
| `your-repo-name` | Artifact Registry repository name | `my-frontend` |
| `your-service` | Docker image name | `frontend` |
| `your-project-dev` | Cloud Run service name (dev) | `myapp-frontend-dev` |
| `your-project-staging` | Cloud Run service name (staging) | `myapp-frontend-staging` |
| `your-project` | Cloud Run service name (prod) | `myapp-frontend` |
| `api-dev.yourdomain.com` | Development API URL | `https://api-dev.example.com/v1` |
| `api-staging.yourdomain.com` | Staging API URL | `https://api-staging.example.com/v1` |
| `api.yourdomain.com` | Production API URL | `https://api.example.com/v1` |
| `G-XXXXXXXXXX` | Google Analytics Measurement ID | `G-MH2G47MCGE` |
| `europe-west2` | GCP Region | `us-central1`, `europe-west1`, etc. |

## Step 5: Set Up Google Cloud Resources

### 5.1 Create Artifact Registry Repository

```bash
gcloud artifacts repositories create your-repo-name \
  --repository-format=docker \
  --location=europe-west2 \
  --description="Docker repository for frontend images"
```

### 5.2 Configure Docker Authentication

```bash
gcloud auth configure-docker europe-west2-docker.pkg.dev
```

### 5.3 Create Cloud Build Triggers

#### Development Trigger

```bash
gcloud builds triggers create github \
  --name="deploy-dev" \
  --repo-name="your-repo" \
  --repo-owner="your-github-org" \
  --branch-pattern="^dev$" \
  --build-config="cloudbuild-dev.yaml" \
  --region=europe-west2
```

#### Staging Trigger

```bash
gcloud builds triggers create github \
  --name="deploy-staging" \
  --repo-name="your-repo" \
  --repo-owner="your-github-org" \
  --branch-pattern="^staging$" \
  --build-config="cloudbuild-staging.yaml" \
  --region=europe-west2
```

#### Production Trigger

```bash
gcloud builds triggers create github \
  --name="deploy-prod" \
  --repo-name="your-repo" \
  --repo-owner="your-github-org" \
  --branch-pattern="^main$" \
  --build-config="cloudbuild-prod.yaml" \
  --region=europe-west2
```

## Step 6: Environment Variables

### Build-time Variables (Passed via --build-arg)

These are set in the Cloud Build configuration files:

- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_GA_MEASUREMENT_ID` - Google Analytics ID

### Runtime Variables (Set in Cloud Run)

If you need runtime environment variables, set them in Cloud Run:

```bash
gcloud run services update your-project-dev \
  --update-env-vars="NEXT_PUBLIC_FRONTEND_URL=https://dev.yourdomain.com" \
  --region=europe-west2
```

**Important:** Next.js environment variables prefixed with `NEXT_PUBLIC_` are embedded at build time. If you need to change them, you must rebuild the image.

## Step 7: Resource Configuration

### Development Environment
- **CPU**: 1 vCPU
- **Memory**: 512Mi
- **Min Instances**: 0 (scales to zero)
- **Max Instances**: 2
- **Concurrency**: 80 requests per instance
- **Timeout**: 60 seconds

### Staging Environment
- **CPU**: 1 vCPU
- **Memory**: 1Gi
- **Min Instances**: 0
- **Max Instances**: 3
- **Concurrency**: 80 requests per instance
- **Timeout**: 60 seconds

### Production Environment
- **CPU**: 2 vCPU
- **Memory**: 2Gi
- **Min Instances**: 1 (always-on)
- **Max Instances**: 10
- **Concurrency**: 80 requests per instance
- **Timeout**: 60 seconds

Adjust these values based on your application's needs.

## Step 8: Testing the Deployment

### Test Local Docker Build

```bash
docker build \
  -f Dockerfile.cloudrun \
  --build-arg NEXT_PUBLIC_API_URL=https://api-dev.yourdomain.com/v1 \
  --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX \
  -t your-project:test \
  .
```

### Test Local Container

```bash
docker run -p 8080:8080 your-project:test
```

Visit `http://localhost:8080` to verify it works.

### Manual Cloud Build Test

```bash
gcloud builds submit --config=cloudbuild-dev.yaml
```

## Step 9: Deployment Workflow

1. **Development**: Push to `dev` branch → Auto-deploys to dev environment
2. **Staging**: Push to `staging` branch → Auto-deploys to staging environment
3. **Production**: Push to `main` branch → Auto-deploys to production environment

Each deployment:
1. Builds Docker image with environment-specific variables
2. Tags image with SHA and environment tag
3. Pushes to Artifact Registry
4. Deploys to Cloud Run service

## Troubleshooting

### Build Fails: "Cannot find module"

**Problem**: Missing dependencies in standalone build.

**Solution**: Ensure `next.config.js` properly configures standalone output and all dependencies are in `package.json`.

### Build Fails: "Permission denied"

**Problem**: Cloud Build service account lacks permissions.

**Solution**: Grant necessary roles:
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### Deployment Fails: "Image not found"

**Problem**: Image wasn't pushed to Artifact Registry.

**Solution**: Check the push step completed successfully. Verify repository name and location match.

### Application Not Accessible

**Problem**: Service deployed but returns 404 or connection refused.

**Solution**: 
- Verify port is set to 8080
- Check Cloud Run service logs: `gcloud run services logs read your-project-dev`
- Ensure `--allow-unauthenticated` flag is set for public access

### Environment Variables Not Working

**Problem**: `NEXT_PUBLIC_*` variables are undefined in browser.

**Solution**: 
- Variables must be set at build time (via `--build-arg`)
- Rebuild the image after changing environment variables
- Verify variables are prefixed with `NEXT_PUBLIC_` for client-side access

## Additional Configuration

### Custom Domain

To use a custom domain:

```bash
gcloud run domain-mappings create \
  --service=your-project \
  --domain=yourdomain.com \
  --region=europe-west2
```

### SSL Certificate

Cloud Run automatically provisions SSL certificates for custom domains.

### CDN Integration

Consider using Cloud CDN or Cloudflare in front of Cloud Run for better performance.

## Cost Optimization

- **Development/Staging**: Use `min-instances=0` to scale to zero when not in use
- **Production**: Set `min-instances=1` only if you need always-on availability
- **Memory**: Start with lower values and increase if needed
- **CPU**: Use 1 vCPU for most applications, increase only if CPU-bound

## Security Best Practices

1. **Non-root user**: Dockerfile already runs as non-root user
2. **Secrets**: Never put secrets in `NEXT_PUBLIC_*` variables
3. **IAM**: Use least-privilege IAM roles for Cloud Build
4. **VPC**: Consider VPC connector for private API access
5. **CORS**: Configure CORS properly in your backend API

## Monitoring

### View Logs

```bash
# Development
gcloud run services logs read your-project-dev --region=europe-west2

# Production
gcloud run services logs read your-project --region=europe-west2
```

### View Metrics

Use Google Cloud Console → Cloud Run → Metrics to monitor:
- Request count
- Latency
- Error rate
- CPU/Memory usage

## References

- [Next.js Standalone Output](https://nextjs.org/docs/advanced-features/output-file-tracing)
- [Google Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Google Cloud Build Documentation](https://cloud.google.com/build/docs)
- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)

