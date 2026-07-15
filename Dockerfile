FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/.output ./.output
COPY drizzle ./drizzle
COPY scripts/migrate.mjs ./scripts/migrate.mjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", ".output/server/index.mjs"]
