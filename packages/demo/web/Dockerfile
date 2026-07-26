FROM node:20-alpine AS builder

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

RUN npm run build --workspace=@stratum-hq/core && \
    npm run build --workspace=@stratum-hq/sdk && \
    npm run build --workspace=@stratum-hq/db-adapters && \
    npm run build --workspace=@stratum-hq/react && \
    npx vite build packages/demo/web

FROM nginx:alpine AS runner

# nginx:alpine's default.conf listens on port 80; replace it with ours
COPY packages/demo/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/packages/demo/web/dist /usr/share/nginx/html

# Inject the seed-minted API key into config.js at container start.
COPY packages/demo/web/docker-web-entrypoint.sh /docker-web-entrypoint.sh

# nginx runs unprivileged: it needs to write config.js into the web root, so the
# root is owned by nginx. /demo-shared is the volume the seed drops the key on.
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /usr/share/nginx/html && \
    chmod -R 755 /var/cache/nginx && \
    chmod +x /docker-web-entrypoint.sh && \
    mkdir -p /demo-shared && chmod 0777 /demo-shared && \
    sed -i '/^pid/d' /etc/nginx/nginx.conf && \
    echo "pid /tmp/nginx.pid;" >> /etc/nginx/nginx.conf

USER nginx

EXPOSE 3300
CMD ["/docker-web-entrypoint.sh"]
