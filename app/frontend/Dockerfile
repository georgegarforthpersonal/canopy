# Multi-stage Dockerfile for React frontend

# Development stage
FROM node:20-alpine AS development
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose Vite dev server port
EXPOSE 5173

# Run dev server (accessible from host)
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Accept build argument for API URL
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

# Sentry DSN for frontend error monitoring (baked in at build time)
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the app
RUN npm run build


# Production stage
FROM nginx:alpine AS production
WORKDIR /usr/share/nginx/html

# Remove default nginx static assets
RUN rm -rf ./*

# Copy built assets from build stage
COPY --from=build /app/dist .

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
