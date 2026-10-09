# Endpoint Pro server - Linux image, built entirely from the repo (no Windows staging step).
# Build context is the REPO ROOT:
#   docker build -f docker/Dockerfile -t endpoint-pro-server:latest .
# or via compose: `docker compose build`.
#
# The server + web console + Outlook add-in all ship in this one image. The application code
# is compiled to V8 bytecode (.jsc) with a startup integrity check, so the final image has no
# readable application JavaScript. Third-party npm packages install normally and the Prisma
# client/engine are generated for this image's Linux/OpenSSL.
#
# NOTE (Linux limitation): Remote agent install and server-side network scan shell out to
# Windows PowerShell/WinRM and do NOT work in this Linux image. Install agents with the
# downloadable setup exe (Console -> Enrollment Tokens) instead. Everything else works.

# One pinned Node base for every stage so the V8 bytecode always matches the runtime.
ARG NODE_IMAGE=node:20-bookworm-slim

# ---------------------------------------------------------------------------------------------
# 1) builder: install the workspace, build the packages esbuild needs + the console, then
#    bundle the server & seed to minified JS and write the runtime package.json.
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS builder
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
RUN npm ci
RUN npm run build -w @em/shared \
 && npm run build -w @license/shared \
 && npm run build -w @em/console
COPY docker/build ./docker/build
RUN node docker/build/esbuild-bundle.mjs /src /out/bundle \
 && node docker/build/make-runtime.mjs /src /out/app

# ---------------------------------------------------------------------------------------------
# 2) deps: production node_modules + the Linux Prisma client/engine.
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /out/app/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock
COPY packages/server/prisma ./prisma
RUN ./node_modules/.bin/prisma generate --schema prisma/schema.prisma

# ---------------------------------------------------------------------------------------------
# 3) bytecode: compile the minified bundles to .jsc (same Node/V8 as runtime).
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS bytecode
WORKDIR /build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /out/bundle ./bundle
COPY docker/build/compile-bytecode.js ./compile-bytecode.js
RUN node compile-bytecode.js ./bundle ./dist

# ---------------------------------------------------------------------------------------------
# 4) runtime: minimal image; application present only as bytecode.
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=deps /app/node_modules ./node_modules
# Static assets the server serves / needs at runtime.
COPY --from=builder /src/packages/server/prisma ./prisma
COPY --from=builder /src/packages/server/public ./public
COPY --from=builder /src/packages/console/dist ./console-dist
COPY --from=builder /src/packages/server/.env.example ./.env.example
# Bytecode app + integrity loaders.
COPY --from=bytecode /build/dist ./dist

COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# uploads (user content) and agent-installer (downloadable installers) persist via volumes.
VOLUME ["/app/uploads"]
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start"]
