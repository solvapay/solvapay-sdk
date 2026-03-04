FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/tsconfig/ packages/tsconfig/
COPY packages/core/package.json packages/core/
COPY packages/auth/package.json packages/auth/
COPY packages/server/package.json packages/server/
COPY packages/demo-services/package.json packages/demo-services/
COPY examples/mcp-oauth-bridge/package.json examples/mcp-oauth-bridge/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY packages/core/ packages/core/
COPY packages/auth/ packages/auth/
COPY packages/server/ packages/server/
COPY packages/demo-services/ packages/demo-services/
COPY examples/mcp-oauth-bridge/ examples/mcp-oauth-bridge/
RUN pnpm --filter @example/mcp-oauth-bridge... build
RUN pnpm --filter @example/mcp-oauth-bridge deploy --prod /app/deployed

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/deployed ./
ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
EXPOSE 3004
CMD ["node", "dist/index.js"]
