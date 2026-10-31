package main

import (
	"context"
	"flag"
	"github.com/lciga/dirtbound-go/internal/server"
	"github.com/lciga/dirtbound-go/web"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	data := flag.String("data", "data", "legacy JSON directory (one-time PostgreSQL import)")
	databaseURL := flag.String("database-url", os.Getenv("DATABASE_URL"), "PostgreSQL URL; alternatively use PGHOST/PGUSER/PGPASSWORD/PGDATABASE")
	flag.Parse()
	app, err := server.New(web.Files, *databaseURL, filepath.Join(*data, "store.json"))
	if err != nil {
		log.Fatal(err)
	}
	defer app.Close()
	srv := &http.Server{Addr: *addr, Handler: app, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			log.Printf("HTTP shutdown: %v", err)
		}
	}()
	display := *addr
	if len(display) > 0 && display[0] == ':' {
		display = "localhost" + display
	}
	log.Printf("DirtBound Go: http://%s (storage: PostgreSQL)", display)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	stop()
	<-shutdownDone
}
