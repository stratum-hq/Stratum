FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/lib/package.json packages/lib/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/control-plane/package.json packages/control-plane/

# Narrow workspaces to only the packages in this build
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
RUN npm run build --workspace=@stratum-hq/core && \
    npm run build --workspace=@stratum-hq/lib && \
    npm run build --workspace=@stratum-hq/db-adapters && \
    npm run build --workspace=@stratum-hq/control-plane

FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy package.json files for production install
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/lib/package.json ./packages/lib/
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/
COPY --from=builder /app/packages/control-plane/package.json ./packages/control-plane/

# Fresh production install — npm handles hoisting and symlinks correctly
RUN node -e " \
  require('fs').writeFileSync('package.json', JSON.stringify({ \
    name: 'stratum', private: true, \
    workspaces: ['packages/core','packages/lib','packages/db-adapters','packages/control-plane'] \
  }, null, 2));"
RUN npm install --omit=dev

# Copy built output
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/lib/dist ./packages/lib/dist
COPY --from=builder /app/packages/db-adapters/dist ./packages/db-adapters/dist
COPY --from=builder /app/packages/control-plane/dist ./packages/control-plane/dist
COPY --from=builder /app/packages/control-plane/src/db/migrations ./packages/control-plane/dist/db/migrations

RUN addgroup -g 1001 stratum && adduser -u 1001 -G stratum -s /bin/sh -D stratum
USER 1001

EXPOSE 3001
CMD ["node", "packages/control-plane/dist/index.js"]
