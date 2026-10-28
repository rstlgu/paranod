FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY services/container-runner/package.json services/container-runner/package-lock.json ./
RUN npm ci --omit=dev

COPY services/container-runner/index.mjs ./index.mjs

EXPOSE 4050
CMD ["node", "index.mjs"]
