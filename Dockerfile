# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy root package files for workspace setup
COPY package*.json ./

# Copy workspace package files
COPY apps/server/package*.json ./apps/server/
COPY packages/shared/package*.json ./packages/shared/
COPY packages/firebase-config/package*.json ./packages/firebase-config/

# Install dependencies using npm workspaces
RUN npm ci --only=production

# Copy shared packages source code
COPY packages/shared ./packages/shared
COPY packages/firebase-config ./packages/firebase-config

# Copy server source code
COPY apps/server ./apps/server

# Create a non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership of the app directory
RUN chown -R nodejs:nodejs /app
USER nodejs

# Set working directory to server app
WORKDIR /app/apps/server

# Expose the port the app runs on
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5001/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start the server
CMD ["node", "server.js"]
