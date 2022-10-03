FROM node:16.17-alpine

ENV HOME=/home/app

WORKDIR $HOME

COPY package.json package-lock.json $HOME/
RUN npm ci

COPY . $HOME

RUN npm run build

CMD ["node", "dist/app.js"]
