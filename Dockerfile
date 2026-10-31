FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
COPY scripts/export-samples.js ./scripts/export-samples.js
RUN npm run samples
COPY openapi.yaml ./openapi.yaml
ARG GIT_SHA=dev
ENV GIT_SHA=$GIT_SHA
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
