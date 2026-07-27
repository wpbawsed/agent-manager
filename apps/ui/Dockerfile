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

# Nginx config to proxy /api and handle SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
