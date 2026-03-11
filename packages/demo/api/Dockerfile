FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/demo/package.json packages/demo/

# Narrow workspaces to only the packages in this build context
# (root package.json declares packages/* but we only have a subset)
RUN node -e " \
  const fs = require('fs'); \
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  p.workspaces = ['packages/core', 'packages/sdk', 'packages/db-adapters', 'packages/demo']; \
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"
RUN npm install

COPY packages/core/ packages/core/
COPY packages/sdk/ packages/sdk/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/demo/ packages/demo/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@stratum/core && \
    npm run build --workspace=@stratum/sdk && \
    npm run build --workspace=@stratum/db-adapters && \
    npm run build:api --workspace=@stratum/demo

# Remove workspace symlinks so COPY to runner doesn't carry broken links
RUN rm -rf node_modules/@stratum

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy third-party dependencies (workspace symlinks already removed)
COPY --from=builder /app/node_modules ./node_modules

# Copy built workspace packages
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/db-adapters/dist ./packages/db-adapters/dist
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/
COPY --from=builder /app/packages/demo/api/dist ./packages/demo/api/dist
COPY --from=builder /app/packages/demo/package.json ./packages/demo/
COPY --from=builder /app/package.json ./

# Recreate workspace symlinks pointing to the copied package directories
RUN mkdir -p node_modules/@stratum && \
    ln -s ../../packages/core node_modules/@stratum/core && \
    ln -s ../../packages/sdk node_modules/@stratum/sdk && \
    ln -s ../../packages/db-adapters node_modules/@stratum/db-adapters && \
    ln -s ../../packages/demo node_modules/@stratum/demo

EXPOSE 3002
CMD ["node", "packages/demo/api/dist/index.js"]
