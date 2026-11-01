package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"sort"
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

// Kept by the service worker (sw.js) until their ETag changes. Not pages (always
// asked again, they carry the build), not the music (streamed in ranges).
var workerCached = map[string]bool{".js": true, ".mjs": true, ".json": true, ".glb": true, ".car": true, ".bin": true, ".wasm": true,
	".mp3": true, ".wav": true, ".ogg": true, ".webp": true, ".png": true, ".jpg": true, ".svg": true, ".ico": true, ".css": true}

const manifestMarker = "/*__MANIFEST__*/null"

// The service worker's list of assets: path → ETags it may keep (plain, gzip).
// The build changes with any asset, which makes the browser install the new worker.
func workerManifest(assets map[string]staticAsset) (string, []byte) {
	list := map[string][]string{}
	names := []string{}
	for name, asset := range assets {
		if strings.HasPrefix(name, ".precompressed/") || name == "sw.js" || !workerCached[path.Ext(name)] {
			continue
		}
		tags := []string{asset.etag}
		if packed, ok := assets[".precompressed/"+name+".gz"]; ok {
			tags = append(tags, packed.etag)
		}
		list[name] = tags
		names = append(names, name+" "+strings.Join(tags, " "))
	}
	sort.Strings(names)
	sum := sha256.Sum256([]byte(strings.Join(names, "\n")))
	build := fmt.Sprintf("%x", sum[:6])
	raw, _ := json.Marshal(map[string]any{"build": build, "assets": list})
	return build, raw
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
	build, manifest := workerManifest(assets)
	var worker []byte
	if source, err := fs.ReadFile(files, "sw.js"); err == nil {
		worker = bytes.Replace(source, []byte(manifestMarker), manifest, 1)
	}
	workerTag := fmt.Sprintf(`"%x"`, sha256.Sum256(worker))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Build", build)
		if r.URL.Path == "/sw.js" && worker != nil {
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("ETag", workerTag)
			http.ServeContent(w, r, "sw.js", time.Time{}, bytes.NewReader(worker))
			return
		}
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
