FROM node:22 AS builder

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://registry.npmmirror.com \
    && npm install --legacy-peer-deps --no-audit --no-fund

COPY . .

# 若未提供 .env，则使用 .env.example 作为默认配置（指向 https://ai.xxturbo.com）
RUN [ -f .env ] || cp .env.example .env

ENV NODE_OPTIONS=--openssl-legacy-provider

RUN npm run build


FROM nginx:stable-alpine3.23-perl

COPY --from=builder /app/build /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
