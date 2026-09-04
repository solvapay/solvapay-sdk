FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY internal/tsconfig/ internal/tsconfig/
COPY sdks/typescript/core/package.json sdks/typescript/core/
COPY sdks/typescript/auth/package.json sdks/typescript/auth/
COPY sdks/typescript/server/package.json sdks/typescript/server/
COPY internal/demo-services/package.json internal/demo-services/
COPY examples/typescript/mcp-oauth-bridge/package.json examples/typescript/mcp-oauth-bridge/
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app ./
COPY sdks/typescript/core/ sdks/typescript/core/
COPY sdks/typescript/auth/ sdks/typescript/auth/
COPY sdks/typescript/server/ sdks/typescript/server/
COPY internal/demo-services/ internal/demo-services/
COPY examples/typescript/mcp-oauth-bridge/ examples/typescript/mcp-oauth-bridge/
RUN pnpm --filter @example/mcp-oauth-bridge... build
RUN pnpm --filter @example/mcp-oauth-bridge deploy --prod /app/deployed

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/deployed ./
ENV NODE_ENV=production
ENV MCP_HOST=0.0.0.0
EXPOSE 3004
CMD ["node", "dist/index.js"]
