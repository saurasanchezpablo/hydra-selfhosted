FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN mkdir -p /data/artifacts
EXPOSE 3000
CMD ["node", "dist/index.js"]
