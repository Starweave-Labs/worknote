FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY server/package*.json ./server/
COPY client/package*.json ./client/
RUN npm --prefix server ci --no-audit --no-fund && npm --prefix client ci --no-audit --no-fund
COPY server/ ./server/
COPY client/ ./client/
COPY package.json ./
RUN npm run build && npm --prefix server prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8000 WORKNOTE_ROOT=/data WORKNOTE_ENV_FILE=""
WORKDIR /app
COPY --from=build /app/server/package*.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/public/app ./public/app
COPY package.json LICENSE ./
COPY scripts/init.mjs ./scripts/init.mjs
COPY examples ./examples
COPY docker/entrypoint.sh /usr/local/bin/worknote-entrypoint
RUN chmod 755 /usr/local/bin/worknote-entrypoint && mkdir /data && chown node:node /data
USER node
EXPOSE 8000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["worknote-entrypoint"]
CMD ["node", "server/dist/index.js"]
