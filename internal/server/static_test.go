package server

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
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

func TestHomeAndMenuHaveSeparateRoutes(t *testing.T) {
	handler := httpFiles(fstest.MapFS{"site.html": {Data: []byte("portal")}, "index.html": {Data: []byte("3d menu")}})
	for _, route := range []struct{ path, body string }{{"/", "portal"}, {"/site.html", "portal"}, {"/menu.html", "3d menu"}, {"/index.html", "3d menu"}} {
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", route.path, nil))
		if w.Code != 200 || w.Body.String() != route.body {
			t.Fatal(route.path, w.Code, w.Body.String())
		}
	}
}
