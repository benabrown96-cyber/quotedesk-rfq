FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Copy source
COPY . .

# Build client + server
RUN npm run build

# Data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_PATH=/app/data/data.db

CMD ["node", "dist/index.cjs"]
