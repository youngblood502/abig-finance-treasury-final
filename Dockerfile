# Three images from one file:  app (the website), tools (worker and migrations).
FROM node:22-alpine AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-alpine AS app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S abig && adduser -S abig -G abig && mkdir -p /data/storage && chown abig:abig /data/storage
COPY --from=build --chown=abig:abig /src/.next/standalone ./
COPY --from=build --chown=abig:abig /src/.next/static ./.next/static
COPY --from=build --chown=abig:abig /src/public ./public
USER abig
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

FROM node:22-alpine AS tools
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S abig && adduser -S abig -G abig
COPY --from=build --chown=abig:abig /src/node_modules ./node_modules
COPY --from=build --chown=abig:abig /src/dist ./dist
COPY --from=build --chown=abig:abig /src/ops ./ops
COPY --from=build --chown=abig:abig /src/prisma/migrations ./prisma/migrations
COPY --from=build --chown=abig:abig /src/package.json ./package.json
USER abig
CMD ["node", "dist/worker.js"]
