FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/lib/package.json packages/lib/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/control-plane/package.json packages/control-plane/
RUN npm install --workspace=@stratum/core --workspace=@stratum/lib --workspace=@stratum/db-adapters --workspace=@stratum/control-plane

COPY packages/core/ packages/core/
COPY packages/lib/ packages/lib/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/control-plane/ packages/control-plane/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@stratum/core && \
    npm run build --workspace=@stratum/lib && \
    npm run build --workspace=@stratum/db-adapters && \
    npm run build --workspace=@stratum/control-plane

# Resolve workspace symlinks into real copies for the runner stage
# Use rsync to skip broken symlinks (workspace packages not in this build)
RUN apk add --no-cache rsync && \
    rsync -a --copy-links --safe-links node_modules/ node_modules_resolved/

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules_resolved ./node_modules
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

EXPOSE 3001
CMD ["node", "packages/control-plane/dist/index.js"]
