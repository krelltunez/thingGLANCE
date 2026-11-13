# thingGLANCE is a static web app: build it, then serve the files with nginx.
#
# Unlike its siblings there is no Node sidecar in the runtime image. That
# sidecar exists to proxy WebDAV past the browser's CORS rules, and
# thingGLANCE syncs only through GLANCEvault, which the browser talks to
# directly.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
