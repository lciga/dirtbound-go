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
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", ":8080", "HTTP listen address")
	data := flag.String("data", "data", "persistent data directory")
	flag.Parse()
	app, err := server.New(web.Files, *data)
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{Addr: *addr, Handler: app, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 90 * time.Second, MaxHeaderBytes: 1 << 20}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	display := *addr
	if len(display) > 0 && display[0] == ':' {
		display = "localhost" + display
	}
	log.Printf("DirtBound Go: http://%s (data: %s)", display, *data)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
