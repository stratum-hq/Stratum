FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/demo/package.json packages/demo/
RUN npm install --workspace=@stratum/core --workspace=@stratum/sdk --workspace=@stratum/db-adapters --workspace=@stratum/demo

COPY packages/core/ packages/core/
COPY packages/sdk/ packages/sdk/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/demo/ packages/demo/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@stratum/core && \
    npm run build --workspace=@stratum/sdk && \
    npm run build --workspace=@stratum/db-adapters && \
    npm run build:api --workspace=@stratum/demo

# Resolve workspace symlinks into real copies for the runner stage
RUN cp -rL node_modules node_modules_resolved

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules_resolved ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder /app/packages/sdk/package.json ./packages/sdk/
COPY --from=builder /app/packages/db-adapters/dist ./packages/db-adapters/dist
COPY --from=builder /app/packages/db-adapters/package.json ./packages/db-adapters/
COPY --from=builder /app/packages/demo/api/dist ./packages/demo/api/dist
COPY --from=builder /app/packages/demo/package.json ./packages/demo/
COPY --from=builder /app/package.json ./

EXPOSE 3002
CMD ["node", "packages/demo/api/dist/index.js"]
