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

CMD ["node_modules/.bin/tsx", "src/app.ts"]
