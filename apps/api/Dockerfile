FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install --omit=dev

# Copy source
COPY src ./src
COPY tsconfig.json ./

# Install tsx for runtime (since we use ESM + TypeScript)
RUN npm install tsx

# Create data directory
RUN mkdir -p /data

EXPOSE 8080

# Apply pending migrations before serving traffic. Idempotent — drizzle
# tracks what's already applied, so this is safe on every boot/restart.
CMD ["sh", "-c", "node_modules/.bin/tsx src/db/migrate.ts && node_modules/.bin/tsx src/app.ts"]
