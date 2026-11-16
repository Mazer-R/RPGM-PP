# Experiment image: Node on ARM64 Linux with node-canvas (Cairo), used to give
# the minimal runner a real Canvas 2D implementation. Game files are mounted
# at run time and never copied in.
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/lab
RUN npm install --no-audit --no-fund canvas@3
ENV NODE_PATH=/opt/lab/node_modules
USER node
WORKDIR /lab
