FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/control-plane/package.json packages/control-plane/
RUN npm install --workspace=@stratum/core --workspace=@stratum/control-plane

COPY packages/core/ packages/core/
COPY packages/control-plane/ packages/control-plane/
COPY tsconfig.base.json ./
RUN npm run build --workspace=@stratum/core && npm run build --workspace=@stratum/control-plane

FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/control-plane/dist ./packages/control-plane/dist
COPY --from=builder /app/packages/control-plane/package.json ./packages/control-plane/
COPY --from=builder /app/packages/control-plane/src/db/migrations ./packages/control-plane/src/db/migrations
COPY --from=builder /app/package.json ./

EXPOSE 3001
CMD ["node", "packages/control-plane/dist/index.js"]
