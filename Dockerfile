# syntax=docker/dockerfile:1
ARG GO_VERSION=1.27
ARG ALPINE_VERSION=3.22

FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download && go mod verify
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/ ./web/
COPY --chmod=0755 tools/build.sh ./tools/build.sh
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOOS=${TARGETOS} GOARCH=${TARGETARCH} ./tools/build.sh

FROM alpine:${ALPINE_VERSION}
RUN addgroup -S -g 10001 game \
    && adduser -S -D -H -u 10001 -G game game \
    && mkdir /data \
    && chown 10001:10001 /data
COPY --from=build /src/bin/dirtbound /usr/local/bin/dirtbound
USER 10001:10001
WORKDIR /data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -T 3 -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/dirtbound"]
CMD ["-addr", ":8080", "-data", "/data"]
