FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --build-from-source
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install --omit=dev --build-from-source
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data/artifacts
EXPOSE 3000
CMD ["node", "dist/index.js"]
