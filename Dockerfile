FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN curl https://install.fuel.network | sh -s -- --no-modify-path \
  && cp /root/.fuelup/bin/forc /usr/local/bin/forc \
  && chmod +x /usr/local/bin/forc \
  && forc --version

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js ./

ENV PORT=3001
EXPOSE 3001
CMD ["node", "server.js"]
