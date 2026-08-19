# Talos cluster nodes are amd64 — pin so Apple Silicon hosts don't publish arm64.
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/

FROM --platform=linux/amd64 node:22-slim AS build
ARG NPM_CONFIG_REGISTRY
WORKDIR /app
ENV NPM_CONFIG_REGISTRY=${NPM_CONFIG_REGISTRY}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM --platform=linux/amd64 node:22-slim
ARG NPM_CONFIG_REGISTRY
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm_config_registry=${NPM_CONFIG_REGISTRY} npm ci --omit=dev
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
