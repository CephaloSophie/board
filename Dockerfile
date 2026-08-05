# ---- client build ----
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# ---- server runtime (serves the built SPA + the API) ----
FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN npm --prefix server install --omit=dev
COPY server ./server
COPY tasks.json ./tasks.json
COPY --from=client-build /app/client/dist ./client/dist

WORKDIR /app/server
EXPOSE 4000
CMD ["node", "src/index.js"]
