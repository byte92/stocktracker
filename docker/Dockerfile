# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  PNPM_HOME=/pnpm \
  PATH=/pnpm:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
COPY scripts/only-pnpm.cjs ./scripts/only-pnpm.cjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --config.node-linker=hoisted --store-dir=/pnpm/store

FROM deps AS builder
COPY . .
RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
  pnpm build

FROM ${NODE_IMAGE} AS runner
LABEL org.opencontainers.image.title="StockTracker" \
  org.opencontainers.image.description="Local-first portfolio tracker and AI investing copilot." \
  org.opencontainers.image.source="https://github.com/byte92/stocktracker" \
  org.opencontainers.image.licenses="MIT"

WORKDIR /app
ENV NODE_ENV=production \
  NEXT_TELEMETRY_DISABLED=1 \
  HOSTNAME=0.0.0.0 \
  FINANCE_SQLITE_PATH=/app/data/finance.sqlite \
  PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN groupadd --system pwuser \
  && useradd --system --create-home --gid pwuser --shell /usr/sbin/nologin pwuser

COPY --from=deps /app/node_modules/playwright ./node_modules/playwright
COPY --from=deps /app/node_modules/playwright-core ./node_modules/playwright-core

RUN printf 'Acquire::Retries "5";\nAcquire::http::Pipeline-Depth "0";\nAcquire::http::No-Cache "true";\n' > /etc/apt/apt.conf.d/99-stocktracker-retries \
  && node node_modules/playwright/cli.js install --with-deps --only-shell chromium \
  && chmod -R 755 /ms-playwright \
  && rm -rf /var/lib/apt/lists/* /tmp/* /root/.cache

RUN mkdir -p /app/data /app/skills/custom \
  && chown -R pwuser:pwuser /app/data /app/skills

COPY scripts/docker-entrypoint.sh /usr/local/bin/stocktracker-entrypoint
RUN chmod +x /usr/local/bin/stocktracker-entrypoint

COPY --from=builder --chown=pwuser:pwuser /app/.next/standalone ./
COPY --from=builder --chown=pwuser:pwuser /app/.next/static ./.next/static
COPY --from=builder --chown=pwuser:pwuser /app/app/icon.svg ./app/icon.svg
COPY --from=builder --chown=pwuser:pwuser /app/skills ./skills

VOLUME ["/app/data"]

ENTRYPOINT ["stocktracker-entrypoint"]
CMD ["node", "server.js"]
