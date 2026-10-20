# syntax=docker/dockerfile:1
# overindex production image for Compute Engine (D-025).
# Build on a machine with more than 1 GB RAM. Do not `docker build` on the e2-micro.
# Secrets are runtime env only; never build args or image layers.

FROM node:22-bookworm-slim AS base
RUN node -e "const p=process.versions.node.split('.').map(Number); if(!(p[0]>22||(p[0]===22&&p[1]>=19))){console.error('Node '+process.versions.node+' is below 22.19'); process.exit(1)}"

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    HOME=/home/app \
    CACHE_DIR=/data

# HOME=/home/app makes this global npm install create /home/app as root.
# useradd then leaves that directory root-owned, so chown it before USER app.
RUN npm install --global @qloo/qloo-harness@0.1.26 \
 && npm ls --global --depth=0 @qloo/qloo-harness \
 && npm cache clean --force \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/app --shell /usr/sbin/nologin app \
 && chown -R app:nodejs /home/app \
 && mkdir -p /data \
 && chown app:nodejs /data \
 && command -v runuser \
 && command -v qloo

COPY --from=build --chown=app:nodejs /app/.next/standalone ./
COPY --from=build --chown=app:nodejs /app/.next/static ./.next/static
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh

# Harness default host is api.qloo.com. Hackathon keys fail with QLOO_AUTH unless
# this user-level config exists before `qloo mcp` starts.
USER app
RUN qloo api config set base-url https://hackathon.api.qloo.com \
 && qloo api config get base-url | grep -F "https://hackathon.api.qloo.com" \
 && chmod 700 /home/app/.qloo

# Root only long enough to chown the boot-disk bind mount (/data), then drop to app.
USER root
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
