# Build from the repository root: docker build -f apps/api/Dockerfile -t clipstage-api .
FROM oven/bun:1.4.2-slim AS base
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/database/package.json packages/database/
RUN bun install --frozen-lockfile --filter @clipstage/api --filter @clipstage/database
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN cd packages/database && bunx prisma generate \
    && cd /app/apps/api && bun run build

FROM base AS runtime
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/node_modules apps/api/node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
USER bun
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["bun", "dist/main.js"]
# Apply migrations as a one-off before rollout:
#   docker run --rm -e DATABASE_URL=... clipstage-api sh -c "cd /app/packages/database && bunx prisma migrate deploy"
