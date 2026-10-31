#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p web/wasm bin
GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -o web/wasm/physics.wasm ./cmd/physics
runtime="$(go env GOROOT)/lib/wasm/wasm_exec.js"
if [ ! -f "$runtime" ]; then runtime="$(go env GOROOT)/misc/wasm/wasm_exec.js"; fi
cp "$runtime" web/wasm/wasm_exec.js
GOOS="$(go env GOHOSTOS)" GOARCH="$(go env GOHOSTARCH)" go run ./cmd/assetgen
go build -buildvcs=false -trimpath -o bin/dirtbound ./cmd/server
