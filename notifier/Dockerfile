# Build from the repository root (the CRT client is a file dependency in .refs/crt/client, built beforehand):
#   docker build -f notifier/Dockerfile -t dms-notifier .
FROM node:22-slim AS build
WORKDIR /src
COPY .refs/crt/client /src/.refs/crt/client
COPY notifier/package.json notifier/package-lock.json /src/notifier/
WORKDIR /src/notifier
RUN npm ci
COPY notifier/tsconfig.json notifier/tsconfig.build.json /src/notifier/
COPY notifier/src /src/notifier/src
RUN npm run build && cp -r src/i18n dist/ 2>/dev/null || true

FROM node:22-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8787 CRT_DEPLOYMENTS_DIR=/app/deployments
WORKDIR /app
COPY --from=build /src/.refs/crt/client /.refs/crt/client
COPY notifier/package.json notifier/package-lock.json /app/
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /src/notifier/dist /app/dist
COPY notifier/scripts /app/scripts
COPY config /app/deployments
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
