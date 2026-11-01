package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestStaticCompressionConditionalAndRanges(t *testing.T) {
	raw := []byte("const answer = 42;\n")
	var zipped bytes.Buffer
	gz := gzip.NewWriter(&zipped)
	gz.Write(raw)
	gz.Close()
	handler := httpFiles(fstest.MapFS{"js/a.js": {Data: raw}, ".precompressed/js/a.js.gz": {Data: zipped.Bytes()}, "embed.go": {Data: []byte("private")}})
	get := func(encoding, etag, span string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/js/a.js", nil)
		req.Header.Set("Accept-Encoding", encoding)
		req.Header.Set("If-None-Match", etag)
		req.Header.Set("Range", span)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, req)
		return w
	}
	packed := get("br, gzip;q=0.8", "", "")
	if packed.Code != 200 || packed.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal(packed.Code, packed.Header())
	}
	reader, err := gzip.NewReader(packed.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, _ := io.ReadAll(reader)
	if !bytes.Equal(decoded, raw) {
		t.Fatal("gzip content")
	}
	if cached := get("gzip", packed.Header().Get("ETag"), ""); cached.Code != 304 || cached.Body.Len() != 0 {
		t.Fatal("conditional GET")
	}
	plain := get("gzip;q=0, *;q=1", "", "")
	if plain.Header().Get("Content-Encoding") != "" || !bytes.Equal(plain.Body.Bytes(), raw) || plain.Header().Get("ETag") == packed.Header().Get("ETag") {
		t.Fatal("encoding negotiation")
	}
	partial := get("gzip", "", "bytes=0-4")
	if partial.Code != 206 || partial.Body.String() != "const" || partial.Header().Get("Content-Encoding") != "" {
		t.Fatal("range", partial.Code, partial.Body.String())
	}
	for _, name := range []string{"/embed.go", "/.precompressed/js/a.js.gz"} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", name, nil))
		if w.Code != 404 {
			t.Fatal("private asset exposed")
		}
	}
	head := httptest.NewRecorder()
	handler.ServeHTTP(head, httptest.NewRequest("HEAD", "/js/a.js", nil))
	if head.Body.Len() != 0 || head.Code != 200 {
		t.Fatal("HEAD")
	}
}

func TestHomeOpensGameAndOldPortalRedirects(t *testing.T) {
	handler := httpFiles(fstest.MapFS{"site.html": {Data: []byte("portal")}, "index.html": {Data: []byte("3d menu")}})
	for _, route := range []struct{ path, body string }{{"/", "3d menu"}, {"/menu.html", "3d menu"}, {"/index.html", "3d menu"}} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", route.path, nil))
		if w.Code != 200 || w.Body.String() != route.body {
			t.Fatal(route.path, w.Code, w.Body.String())
		}
	}
}

func TestOldPortalRedirectsIntoMenu(t *testing.T) {
	handler := httpFiles(fstest.MapFS{"index.html": {Data: []byte("game")}})
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest("GET", "/site.html", nil))
	if w.Code != 303 || w.Header().Get("Location") != "/menu.html" {
		t.Fatal(w.Code, w.Header())
	}
}

func TestServiceWorkerManifestAndBuild(t *testing.T) {
	files := fstest.MapFS{
		"sw.js":                     {Data: []byte("const MANIFEST = " + manifestMarker + ";")},
		"js/a.js":                   {Data: []byte("a")},
		".precompressed/js/a.js.gz": {Data: []byte("gz")},
		"index.html":                {Data: []byte("page")},
		"audio/music/song.m4a":      {Data: []byte("song")},
	}
	get := func(h http.Handler, target string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", target, nil))
		return w
	}
	handler := httpFiles(files)
	w := get(handler, "/sw.js")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-cache" || !strings.Contains(w.Header().Get("Content-Type"), "javascript") {
		t.Fatal(w.Code, w.Header())
	}
	var manifest struct {
		Build  string              `json:"build"`
		Assets map[string][]string `json:"assets"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSuffix(strings.TrimPrefix(w.Body.String(), "const MANIFEST = "), ";")), &manifest); err != nil {
		t.Fatal(err, w.Body.String())
	}
	page := get(handler, "/index.html")
	if manifest.Build == "" || page.Header().Get("X-Build") != manifest.Build {
		t.Fatal("build header", manifest.Build, page.Header().Get("X-Build"))
	}
	if len(manifest.Assets) != 1 || len(manifest.Assets["js/a.js"]) != 2 || manifest.Assets["js/a.js"][0] != get(handler, "/js/a.js").Header().Get("ETag") {
		t.Fatal("assets kept by the worker", manifest.Assets)
	}
	files["js/a.js"] = &fstest.MapFile{Data: []byte("changed")}
	if next := get(httpFiles(files), "/index.html").Header().Get("X-Build"); next == manifest.Build {
		t.Fatal("build must change with an asset")
	}
}
