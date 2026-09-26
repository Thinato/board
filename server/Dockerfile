# Board server image: Node app + the 8-bit Serafim model, built from source (the model file is too big for git).

# 1. Model: download the pinned ONNX export and quantize it, exactly as setup-model.sh does locally.
FROM python:3.12-slim AS model
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY setup-model.sh .
RUN sh setup-model.sh

# 2. Production dependencies, minus what Node never loads: the browser ONNX runtime (transformers.js
#    marks it ignored in its Node build) and onnxruntime-node binaries for other platforms.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && rm -rf node_modules/onnxruntime-web \
 && ARCH=$(node -p process.arch) \
 && find node_modules/onnxruntime-node/bin/napi-v3 -mindepth 2 -maxdepth 2 ! -path "*/linux/$ARCH" -exec rm -rf {} +

# 3. Runtime.
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=model /app/models models
COPY package.json *.js ./
USER node
EXPOSE 8080
CMD ["node", "server.js"]
