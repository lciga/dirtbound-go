package server

import (
	"context"
	"github.com/coder/websocket"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func TestBetaCodePersistsAndRoomsRejectNonTesters(t *testing.T) {
	t.Setenv("BETA_TESTER_CODE", "test-fixture-not-a-real-beta-code")
	a, s, c := newTest(t)
	login(t, c, s.URL, "Beta Tester")
	if call(t, c, "POST", s.URL+"/api/me/beta", map[string]any{"code": "wrong", "beta": true})["success"] != false {
		t.Fatal("wrong code accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	dial := func(client *http.Client) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/api/lobby", &websocket.DialOptions{HTTPClient: client})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.CloseNow() })
		return conn
	}
	x := dial(c)
	wsSend(t, ctx, x, map[string]any{"t": "create", "mode": "beta"})
	wsRead(t, ctx, x, "error")
	result := call(t, c, "POST", s.URL+"/api/me/beta", map[string]any{"code": "test-fixture-not-a-real-beta-code"})
	if result["success"] != true || result["data"].(map[string]any)["beta"] != true {
		t.Fatal(result)
	}
	if call(t, c, "GET", s.URL+"/api/me", nil)["data"].(map[string]any)["beta"] != true {
		t.Fatal("beta not persistent")
	}
	wsSend(t, ctx, x, map[string]any{"t": "create", "mode": "beta", "yaris": true})
	room := wsRead(t, ctx, x, "lobby")["lobby"].(map[string]any)
	jar, _ := cookiejar.New(nil)
	guest := &http.Client{Jar: jar}
	login(t, guest, s.URL, "Ordinary User")
	y := dial(guest)
	wsSend(t, ctx, y, map[string]any{"t": "join", "code": room["code"]})
	wsRead(t, ctx, y, "error")
	if call(t, guest, "POST", s.URL+"/api/me/beta", map[string]any{"code": "test-fixture-not-a-real-beta-code"})["success"] != true {
		t.Fatal("second tester could not redeem")
	}
	wsSend(t, ctx, y, map[string]any{"t": "join", "code": room["code"]})
	wsRead(t, ctx, y, "lobby")
	for _, conn := range []*websocket.Conn{x, y} {
		wsSend(t, ctx, conn, map[string]any{"t": "ready", "ready": true, "car": "BMW E30", "color": 2})
	}
	for {
		m := wsRead(t, ctx, x, "lobby")
		count := 0
		for _, raw := range m["lobby"].(map[string]any)["players"].([]any) {
			if raw.(map[string]any)["ready"] == true {
				count++
			}
		}
		if count == 2 {
			break
		}
	}
	a.hub.mu.Lock()
	l := a.hub.rooms[room["code"].(string)]
	a.hub.closeVote(l)
	mode, yaris := l.Race.Mode, l.Race.Yaris
	grid := append([]*Player(nil), l.Race.Grid...)
	a.hub.mu.Unlock()
	if mode != "beta" || !yaris || len(grid) != 2 {
		t.Fatal("modifiers not in race", mode, yaris)
	}
	for _, p := range grid {
		if p.Car != "Toyota Yaris" {
			t.Fatal("not all testers have forced Yaris", p)
		}
	}
}
func TestCarUpdatesBroadcastAndResetReady(t *testing.T) {
	_, s, c := newTest(t)
	login(t, c, s.URL, "Garage Tester")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/api/lobby", &websocket.DialOptions{HTTPClient: c})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	wsSend(t, ctx, conn, map[string]any{"t": "create"})
	wsRead(t, ctx, conn, "lobby")
	wsSend(t, ctx, conn, map[string]any{"t": "ready", "ready": true, "car": "BMW E30", "color": 1})
	wsRead(t, ctx, conn, "lobby")
	wsSend(t, ctx, conn, map[string]any{"t": "car", "car": "Toyota Yaris", "color": 3})
	pl := wsRead(t, ctx, conn, "lobby")["lobby"].(map[string]any)["players"].([]any)[0].(map[string]any)
	if pl["car"] != "Toyota Yaris" || pl["color"] != float64(3) || pl["ready"] != false {
		t.Fatal(pl)
	}
}

func TestBetaMigrationPreservesExistingAccountAndSession(t *testing.T) {
	t.Setenv("BETA_TESTER_CODE", "test-fixture-migration-beta-code")
	a, s, c := newTest(t)
	login(t, c, s.URL, "Existing Driver")
	before := call(t, c, "GET", s.URL+"/api/me", nil)["data"].(map[string]any)
	// Recreate the previous release's schema in this isolated test schema only.
	if _, err := a.db.Exec(context.Background(), "ALTER TABLE accounts DROP COLUMN beta_access; DELETE FROM schema_migrations WHERE version=2"); err != nil {
		t.Fatal(err)
	}
	upgraded, err := New(fstest.MapFS{}, a.db.Config().ConnConfig.ConnString(), "")
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	updatedHTTP := httptest.NewServer(upgraded)
	defer updatedHTTP.Close()
	after := call(t, c, "GET", updatedHTTP.URL+"/api/me", nil)["data"].(map[string]any)
	if after["id"] != before["id"] || after["pseudo"] != before["pseudo"] || after["beta"] != false {
		t.Fatal("old account/session lost during migration", before, after)
	}
	if call(t, c, "POST", updatedHTTP.URL+"/api/me/beta", map[string]any{"code": "test-fixture-migration-beta-code"})["success"] != true {
		t.Fatal("activation after upgrade")
	}
	again, err := New(fstest.MapFS{}, a.db.Config().ConnConfig.ConnString(), "")
	if err != nil {
		t.Fatal("repeat migration", err)
	}
	defer again.Close()
	var granted bool
	var versions, accounts, credentials, sessions int
	if err = again.db.QueryRow(context.Background(), "SELECT beta_access FROM accounts WHERE id=$1", before["id"]).Scan(&granted); err != nil {
		t.Fatal(err)
	}
	if err = again.db.QueryRow(context.Background(), "SELECT (SELECT count(*) FROM schema_migrations WHERE version=2),(SELECT count(*) FROM accounts),(SELECT count(*) FROM credentials),(SELECT count(*) FROM sessions)").Scan(&versions, &accounts, &credentials, &sessions); err != nil {
		t.Fatal(err)
	}
	if !granted || versions != 1 || accounts != 1 || credentials != 1 || sessions != 1 {
		t.Fatal("restart changed persisted data", granted, versions, accounts, credentials, sessions)
	}
}
