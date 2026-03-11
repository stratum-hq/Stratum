FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/lib/package.json packages/lib/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/control-plane/package.json packages/control-plane/

# Narrow workspaces to only the packages in this build context
# (root package.json declares packages/* but we only have a subset)
RUN node -e " \
  const fs = require('fs'); \
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  p.workspaces = ['packages/core', 'packages/lib', 'packages/db-adapters', 'packages/control-plane']; \
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"
RUN npm install

COPY packages/core/ packages/core/
COPY packages/lib/ packages/lib/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/control-plane/ packages/control-plane/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@stratum/core && \
    npm run build --workspace=@stratum/lib && \
    npm run build --workspace=@stratum/db-adapters && \
    npm run build --workspace=@stratum/control-plane

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
COPY --from=builder /app/packages/lib/dist ./packages/lib/dist
COPY --from=builder /app/packages/lib/package.json ./packages/lib/
COPY --from=builder /app/packages/db-adapters/dist ./packages/db-adapters/dist
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/
COPY --from=builder /app/packages/control-plane/dist ./packages/control-plane/dist
COPY --from=builder /app/packages/control-plane/package.json ./packages/control-plane/
COPY --from=builder /app/packages/control-plane/src/db/migrations ./packages/control-plane/src/db/migrations
COPY --from=builder /app/package.json ./

# Recreate workspace symlinks pointing to the copied package directories
RUN mkdir -p node_modules/@stratum && \
    ln -s ../../packages/core node_modules/@stratum/core && \
    ln -s ../../packages/lib node_modules/@stratum/lib && \
    ln -s ../../packages/db-adapters node_modules/@stratum/db-adapters && \
    ln -s ../../packages/control-plane node_modules/@stratum/control-plane

EXPOSE 3001
CMD ["node", "packages/control-plane/dist/index.js"]
