package server

import (
	"context"
	"github.com/coder/websocket"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"testing"
	"time"
)

func TestYarisLobbyForcesCarForBothPlayersAndRaceGrid(t *testing.T) {
	a, s, c1 := newTest(t)
	jar, _ := cookiejar.New(nil)
	c2 := &http.Client{Jar: jar}
	login(t, c1, s.URL, "Yaris One")
	login(t, c2, s.URL, "Yaris Two")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	dial := func(c *http.Client) *websocket.Conn {
		conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/api/lobby", &websocket.DialOptions{HTTPClient: c})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { conn.CloseNow() })
		return conn
	}
	x, y := dial(c1), dial(c2)
	wsSend(t, ctx, x, map[string]any{"t": "create", "mode": "yaris", "visibility": "public"})
	m := wsRead(t, ctx, x, "lobby")
	room := m["lobby"].(map[string]any)
	if room["mode"] != "yaris" {
		t.Fatal("mode lost", room["mode"])
	}
	code := room["code"].(string)
	wsSend(t, ctx, y, map[string]any{"t": "join", "code": code})
	wsRead(t, ctx, y, "lobby")
	for _, conn := range []*websocket.Conn{x, y} {
		wsSend(t, ctx, conn, map[string]any{"t": "ready", "ready": true, "car": "BMW E30", "color": 5})
	}
	for {
		m = wsRead(t, ctx, x, "lobby")
		players := m["lobby"].(map[string]any)["players"].([]any)
		ready := 0
		for _, p := range players {
			pl := p.(map[string]any)
			if pl["car"] != "Toyota Yaris" || pl["color"] != float64(1) {
				t.Fatal("client changed forced model", pl)
			}
			if pl["ready"] == true {
				ready++
			}
		}
		if ready == 2 {
			break
		}
	}
	a.hub.mu.Lock()
	lobby := a.hub.rooms[code]
	a.hub.closeVote(lobby)
	mode := lobby.Race.Mode
	grid := append([]*Player(nil), lobby.Race.Grid...)
	a.hub.mu.Unlock()
	if mode != "yaris" || len(grid) != 2 {
		t.Fatal("bad Yaris race", mode, len(grid))
	}
	for _, p := range grid {
		if p.Car != "Toyota Yaris" || p.Color != 1 {
			t.Fatal("bad race-grid model", p)
		}
	}
}
