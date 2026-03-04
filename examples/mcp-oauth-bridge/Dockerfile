FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
RUN pnpm --filter @example/mcp-oauth-bridge... build

FROM base AS runner
WORKDIR /app
COPY --from=builder /app ./
ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
EXPOSE 3004
CMD ["node", "examples/mcp-oauth-bridge/dist/index.js"]
