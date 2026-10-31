// assetgen precompresses text and WebAssembly once during the build.
package main

import (
	"compress/gzip"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	root := "web"
	dest := filepath.Join(root, ".precompressed")
	if err := os.RemoveAll(dest); err != nil {
		panic(err)
	}
	count := 0
	var original, packed int64
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path == dest {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if !strings.Contains("|.js|.json|.css|.html|.svg|.wasm|", "|"+ext+"|") {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if len(raw) < 512 {
			return nil
		}
		relative, _ := filepath.Rel(root, path)
		target := filepath.Join(dest, relative+".gz")
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		file, err := os.Create(target)
		if err != nil {
			return err
		}
		z, _ := gzip.NewWriterLevel(file, gzip.BestCompression)
		if _, err = z.Write(raw); err == nil {
			err = z.Close()
		}
		closeErr := file.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
		info, err := os.Stat(target)
		if err != nil {
			return err
		}
		if info.Size() >= int64(len(raw)) {
			return os.Remove(target)
		}
		count++
		original += int64(len(raw))
		packed += info.Size()
		return nil
	})
	if err != nil {
		panic(err)
	}
	fmt.Printf("Precompressed %d assets: %d → %d bytes\n", count, original, packed)
}
