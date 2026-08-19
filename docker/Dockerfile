FROM node:22-alpine AS dependencies

WORKDIR /opt/app
COPY app/package.json app/pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /opt/app
COPY --from=dependencies /opt/app/node_modules ./node_modules
COPY --chown=node:node app/src ./src
COPY --chown=node:node app/package.json ./package.json

# Application files are readable by an arbitrary non-root UID used by OpenShift.
RUN chmod -R g=u /opt/app

USER 1001
EXPOSE 3000

CMD ["node", "src/server.js"]
