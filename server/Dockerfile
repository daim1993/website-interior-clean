FROM node:20-alpine
WORKDIR /app
# install server deps
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
# copy the whole site (server serves ../ )
COPY . .
ENV PORT=4000
EXPOSE 4000
WORKDIR /app/server
CMD ["node", "server.js"]
