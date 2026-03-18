FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/demo/package.json packages/demo/

# Narrow workspaces to only the packages in this build, and strip
# web-only dependencies from demo (react, @stratum-hq/react) since
# this image only runs the API server.
RUN node -e " \
  const fs = require('fs'); \
  const root = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  root.workspaces = ['packages/core', 'packages/sdk', 'packages/db-adapters', 'packages/demo']; \
  fs.writeFileSync('package.json', JSON.stringify(root, null, 2)); \
  const demo = JSON.parse(fs.readFileSync('packages/demo/package.json', 'utf8')); \
  delete demo.dependencies['@stratum-hq/react']; \
  delete demo.dependencies['react']; \
  delete demo.dependencies['react-dom']; \
  fs.writeFileSync('packages/demo/package.json', JSON.stringify(demo, null, 2));"
RUN npm install

COPY packages/core/ packages/core/
COPY packages/sdk/ packages/sdk/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/demo/ packages/demo/
COPY tsconfig.base.json ./

# Restore the stripped demo package.json for the build step
# (tsc needs the original for type resolution, but won't install anything)
RUN npm run build --workspace=@stratum-hq/core && \
    npm run build --workspace=@stratum-hq/sdk && \
    npm run build --workspace=@stratum-hq/db-adapters && \
    npm run build:api --workspace=@stratum-hq/demo

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copy package.json files for production install (use builder's stripped demo package.json)
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/

# Strip web-only deps from demo package.json for production install
RUN mkdir -p packages/demo
COPY --from=builder /app/packages/demo/package.json ./packages/demo/tmp.json
RUN node -e " \
  const fs = require('fs'); \
  const demo = JSON.parse(fs.readFileSync('packages/demo/tmp.json', 'utf8')); \
  delete demo.dependencies['@stratum-hq/react']; \
  delete demo.dependencies['react']; \
  delete demo.dependencies['react-dom']; \
  fs.writeFileSync('packages/demo/package.json', JSON.stringify(demo, null, 2)); \
  fs.unlinkSync('packages/demo/tmp.json');"

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

RUN addgroup -g 1001 stratum && adduser -u 1001 -G stratum -s /bin/sh -D stratum
USER 1001

EXPOSE 3002
CMD ["node", "packages/demo/api/dist/index.js"]
