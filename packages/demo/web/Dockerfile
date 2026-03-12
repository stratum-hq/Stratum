FROM node:18-alpine AS builder

WORKDIR /app
COPY package.json ./
COPY packages/core/package.json packages/core/
COPY packages/sdk/package.json packages/sdk/
COPY packages/db-adapters/package.json packages/db-adapters/
COPY packages/react-ui/package.json packages/react-ui/
COPY packages/demo/package.json packages/demo/

# Narrow workspaces to only the packages needed for the web build
RUN node -e " \
  const fs = require('fs'); \
  const p = JSON.parse(fs.readFileSync('package.json', 'utf8')); \
  p.workspaces = ['packages/core', 'packages/sdk', 'packages/db-adapters', 'packages/react-ui', 'packages/demo']; \
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2));"
RUN npm install

COPY packages/core/ packages/core/
COPY packages/sdk/ packages/sdk/
COPY packages/db-adapters/ packages/db-adapters/
COPY packages/react-ui/ packages/react-ui/
COPY packages/demo/ packages/demo/
COPY tsconfig.base.json ./

RUN npm run build --workspace=@stratum/core && \
    npm run build --workspace=@stratum/sdk && \
    npm run build --workspace=@stratum/db-adapters && \
    npm run build --workspace=@stratum/react && \
    npx vite build packages/demo/web

FROM nginx:alpine AS runner

# nginx:alpine's default.conf listens on port 80; replace it with ours
COPY packages/demo/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/demo/web/dist /usr/share/nginx/html

EXPOSE 3300
CMD ["nginx", "-g", "daemon off;"]
