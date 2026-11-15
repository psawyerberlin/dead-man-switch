# Build from the repository root, with CRT cloned into .refs/crt (no Node needed on the host):
#   git clone --depth 1 https://github.com/psawyerberlin/ckb-revocable-timelock .refs/crt
#   docker compose -f notifier/compose.yaml up -d --build
# Stage 1 builds @crt/client from source; stage 2 builds the notifier; stage 3 is the runtime image.

FROM node:22-slim AS crt
WORKDIR /crt/client
COPY .refs/crt/client/ ./
RUN rm -rf node_modules dist && npm ci && npm run build

FROM node:22-slim AS build
WORKDIR /src/notifier
COPY --from=crt /crt/client /src/.refs/crt/client
COPY notifier/package.json notifier/package-lock.json notifier/.npmrc ./
RUN npm ci
COPY notifier/tsconfig.json notifier/tsconfig.build.json ./
COPY notifier/src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 CRT_DEPLOYMENTS_DIR=/app/deployments
WORKDIR /app
COPY --from=crt /crt/client /.refs/crt/client
COPY notifier/package.json notifier/package-lock.json notifier/.npmrc /app/
RUN npm ci --omit=dev && npm cache clean --force && rm -rf /.refs
COPY --from=build /src/notifier/dist /app/dist
COPY notifier/scripts /app/scripts
# CRT's deployment files (<network>.json), which the chain reader loads; not the app's config/.
COPY .refs/crt/deployments /app/deployments
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
