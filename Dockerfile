FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY server.js ./
COPY site ./site
USER node
EXPOSE 8080
CMD ["node", "server.js"]
