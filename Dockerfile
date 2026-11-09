# player.html — build the single-file app, then serve it with directory listings.
#
#   docker build -t player-html .
#   docker run --rm -p 8080:80 \
#     -v /path/to/videos:/library/videos:ro \
#     -v /path/to/audio:/library/audio:ro \
#     -v /path/to/pdfs:/library/pdf:ro \
#     -v /path/to/config:/config:ro \
#     player-html
#
# Open http://localhost:8080/ . /library is the library root; each mount is a folder.
# player.html.json, manifest.json and its icons in /config override the built-in defaults.

FROM python:3.15-alpine AS build

# Release builds pass the tag's version; otherwise src/player.html's is used.
ARG VERSION=
WORKDIR /src
COPY build.py ./
COPY src ./src
RUN python build.py ${VERSION:+--version "$VERSION"}

FROM nginx:1.31-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/player.html.json /opt/player/player.html.json
COPY --from=build /src/dist/player.min.html /opt/player/player.min.html
COPY --from=build /src/dist/player.html /opt/player/player.html

RUN mkdir -p /library /config

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1/player.html || exit 1
