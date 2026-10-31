package web

import "embed"

// Files contains the complete browser application, including Go WebAssembly.
//
//go:embed all:*
var Files embed.FS
