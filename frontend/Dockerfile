FROM node:24-bookworm-slim AS build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --ignore-scripts
COPY frontend/ ./
# M08 temporarily reuses the pure M06 modules until its own backend port.
COPY backend/src/modules/ai/ /app/backend/src/modules/ai/
COPY backend/src/modules/campaigns/script.ts backend/src/modules/campaigns/types.ts backend/src/modules/campaigns/validation.ts /app/backend/src/modules/campaigns/
COPY backend/src/common/catalog.ts backend/src/common/telephony.ts /app/backend/src/common/
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node:node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
