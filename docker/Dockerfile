# Endpoint One server - Linux image, built entirely from the repo (no Windows staging step).
# Build context is the REPO ROOT:
#   docker build -f docker/Dockerfile -t endpoint-one-server:latest .
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
# Optional extra trusted CAs for the build only (never copied into the runtime image): drop a
# PEM *.crt into docker/extra-ca/ when the build machine sits behind TLS interception (e.g.
# Kaspersky/corporate proxy -> npm fails with SELF_SIGNED_CERT_IN_CHAIN). Empty on EC2.
COPY docker/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
# npm can crash mid-install on a network hiccup ("Exit handler never called!") yet exit 0,
# leaving a partial node_modules that only fails later with "tsc: not found". Check the
# install actually completed and retry it a couple of times before giving up.
RUN for attempt in 1 2 3; do \
      npm ci && test -x node_modules/.bin/tsc && test -x node_modules/.bin/esbuild && exit 0; \
      echo "npm ci did not complete (attempt $attempt of 3)"; rm -rf node_modules; sleep 10; \
    done; exit 1
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
# Optional extra trusted CAs for the build only (never copied into the runtime image): drop a
# PEM *.crt into docker/extra-ca/ when the build machine sits behind TLS interception (e.g.
# Kaspersky/corporate proxy -> npm fails with SELF_SIGNED_CERT_IN_CHAIN). Empty on EC2.
COPY docker/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
COPY --from=builder /out/app/package.json ./package.json
# Same partial-install guard as the builder stage: `npm ls` fails if anything is missing.
RUN for attempt in 1 2 3; do \
      npm install --omit=dev --no-audit --no-fund --no-package-lock && npm ls --omit=dev >/dev/null && exit 0; \
      echo "npm install did not complete (attempt $attempt of 3)"; rm -rf node_modules; sleep 10; \
    done; exit 1
COPY packages/server/prisma/schema.prisma ./prisma/schema.prisma
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
# Only what `prisma migrate deploy` needs - not seed.ts (the seed ships as bytecode in dist/)
# and never stray local database files.
COPY --from=builder /src/packages/server/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder /src/packages/server/prisma/migrations ./prisma/migrations
COPY --from=builder /src/packages/server/public ./public
COPY --from=builder /src/packages/console/dist ./console-dist
COPY --from=builder /src/packages/server/.env.example ./.env.example
# Bytecode app + integrity loaders.
COPY --from=bytecode /build/dist ./dist

COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip CRLF in case the build machine is Windows (a CR in the shebang line makes the container
# fail with "exec ... no such file or directory").
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

# uploads (user content) and agent-installer (downloadable installers) persist via volumes.
VOLUME ["/app/uploads"]
EXPOSE 4000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["start"]
