FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN ./tools/build.sh
FROM alpine:3.22
RUN addgroup -S game && adduser -S -G game game && mkdir /data && chown game:game /data
USER game
COPY --from=build /src/bin/dirtbound /usr/local/bin/dirtbound
EXPOSE 8080
VOLUME /data
ENTRYPOINT ["dirtbound", "-addr", ":8080", "-data", "/data"]
