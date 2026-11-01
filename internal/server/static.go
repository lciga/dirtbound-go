package server

import (
	"crypto/sha256"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

type staticAsset struct {
	name string
	etag string
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		name := strings.TrimSpace(fields[0])
		q := 1.0
		for _, parameter := range fields[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if ok && key == "q" {
				var err error
				q, err = strconv.ParseFloat(value, 64)
				if err != nil {
					q = 0
				}
			}
		}
		if name == "gzip" {
			return q > 0
		}
		if name == "*" {
			wildcard = q > 0
		}
	}
	return wildcard
}
func httpFiles(files fs.FS) http.Handler {
	// Immutable embedded assets: hash/compress at build/startup, never per request.
	assets := map[string]staticAsset{}
	fs.WalkDir(files, ".", func(name string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		file, e := files.Open(name)
		if e != nil {
			return nil
		}
		hash := sha256.New()
		_, e = io.Copy(hash, file)
		file.Close()
		if e != nil {
			return nil
		}
		assets[name] = staticAsset{name, fmt.Sprintf(`"%x"`, hash.Sum(nil)[:16])}
		return nil
	})
	// A fresh menu URL also avoids browsers' permanent /index.html → /
	// redirect cached by the previous FileServer version.
	if index, exists := assets["index.html"]; exists {
		assets["menu.html"] = index
		if compressed, ok := assets[".precompressed/index.html.gz"]; ok {
			assets[".precompressed/menu.html.gz"] = compressed
		}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Keep old portal bookmarks useful without a separate page.
		if r.URL.Path == "/site.html" {
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, "/menu.html", http.StatusSeeOther)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" {
			name = "index.html"

		}
		for _, component := range strings.Split(name, "/") {
			if strings.HasPrefix(component, ".") {
				http.NotFound(w, r)
				return
			}
		}
		if strings.HasSuffix(name, ".go") {
			http.NotFound(w, r)
			return
		}
		asset, ok := assets[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(405)
			return
		}
		contentType := mime.TypeByExtension(path.Ext(name))
		if path.Ext(name) == ".wasm" {
			contentType = "application/wasm"
		}
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		if packed, exists := assets[".precompressed/"+name+".gz"]; exists {
			w.Header().Add("Vary", "Accept-Encoding")
			if acceptsGzip(r.Header.Get("Accept-Encoding")) && r.Header.Get("Range") == "" {
				asset = packed
				w.Header().Set("Content-Encoding", "gzip")
			}
		}
		if w.Header().Get("Cache-Control") == "" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		// ETag represents the selected encoding; ServeContent handles conditional GET,
		// HEAD, ranges, and If-Range. Authenticated pages keep the outer no-store.
		w.Header().Set("ETag", asset.etag)
		file, err := http.FS(files).Open(asset.name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		http.ServeContent(w, r, name, time.Time{}, file)
	})
}
