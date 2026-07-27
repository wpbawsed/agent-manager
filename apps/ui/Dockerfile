FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
# Bake the literal placeholder "$VITE_BACKEND_HOST" into the bundle instead of
# a real value — entrypoint.sh substitutes it with the real one at container
# start, so this one image can be deployed anywhere without rebuilding.
RUN VITE_BACKEND_HOST='$VITE_BACKEND_HOST' npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx config to proxy /api and handle SPA routing. Kept as a template (not
# written straight to conf.d) because it listens on ${PORT}, which Railway
# only provides at container start — entrypoint.sh renders it then.
COPY nginx.conf /etc/nginx/templates/default.conf.template
# Override the base image's worker_processes (see nginx-main.conf for why)
COPY nginx-main.conf /etc/nginx/nginx.conf

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
