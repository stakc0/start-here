FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ffmpeg ca-certificates curl nodejs npm \
  && python3 -m pip install --break-system-packages --no-cache-dir -U yt-dlp \
  && yt-dlp --version \
  && node --version \
  && ffmpeg -version \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

ENV NODE_ENV=production
CMD ["npm", "run", "start"]
