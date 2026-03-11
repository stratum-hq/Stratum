FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/demo/package.json packages/demo/

# Narrow workspaces to only the packages in this build
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

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy package.json files for production install
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/
COPY --from=builder /app/packages/demo/package.json ./packages/demo/

# Fresh production install — npm handles hoisting and symlinks correctly
RUN node -e " \
  require('fs').writeFileSync('package.json', JSON.stringify({ \
    name: 'stratum', private: true, \
    workspaces: ['packages/core','packages/sdk','packages/db-adapters','packages/demo'] \
  }, null, 2));"
RUN npm install --omit=dev

# Copy built output
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/db-adapters/dist ./packages/db-adapters/dist
COPY --from=builder /app/packages/demo/api/dist ./packages/demo/api/dist

EXPOSE 3002
CMD ["node", "packages/demo/api/dist/index.js"]
