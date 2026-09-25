# Multi-stage build for VPU Điểm Danh
# Stage 1: Build the React app
# Vite 8 / rolldown requires a newer Node runtime than 18.
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifest
COPY package.json ./

# Install dependencies with npm to avoid pnpm's new build-approval policy in Docker
RUN npm install

# Copy source code and TypeScript/Vite config files required by the build
COPY src ./src
COPY public ./public
COPY index.html vite.config.ts postcss.config.js tailwind.config.js tsconfig.json tsconfig.app.json tsconfig.node.json ./

# Build the application
RUN npm run build

# Stage 2: Production runtime
FROM node:22-alpine

WORKDIR /app

# Copy only the runtime manifest and dependencies
COPY --from=builder /app/package.json ./

# Install production-only dependencies (now includes express/pg/google-auth-library for server/)
RUN npm install --omit=dev

# Copy built frontend and the real backend
COPY --from=builder /app/dist ./dist
COPY server ./server

# Expose port
EXPOSE 3000

# Health check — hits the real /health route (server/index.js), which checks the DB too
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1)).on('error', () => process.exit(1))"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Serve the application (frontend + /api backend)
CMD ["node", "server/index.js"]
