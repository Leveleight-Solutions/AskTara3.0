FROM node:24-slim

WORKDIR /app

# Install build tools for the frontend, then prune them after compilation.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build && npm prune --omit=dev && mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/app/data/asktara.sqlite

USER node
EXPOSE 3001
CMD ["node", "--import", "tsx", "server/index.ts"]
