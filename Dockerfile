FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y curl wget nodejs npm
RUN curl https://install.fuel.network | sh -s -- --no-modify-path
RUN cp /root/.fuelup/bin/forc /usr/local/bin/forc && chmod +x /usr/local/bin/forc
RUN forc --version
WORKDIR /app
COPY package.json ./
RUN npm install
COPY server.js ./
EXPOSE 3001
CMD ["node", "server.js"]
