package server

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTest(t *testing.T) (*App, *httptest.Server, *http.Client) {
	t.Helper()
	a, err := New(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("DirtBound")}}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(a)
	t.Cleanup(s.Close)
	jar, _ := cookiejar.New(nil)
	c := &http.Client{Jar: jar}
	return a, s, c
}
func call(t *testing.T, c *http.Client, method, url string, body any) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(body)
	r, _ := http.NewRequest(method, url, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	res, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	if json.NewDecoder(res.Body).Decode(&out) != nil {
		t.Fatal("invalid API response")
	}
	return out
}
func login(t *testing.T, c *http.Client, url, name string) {
	t.Helper()
	if !call(t, c, "POST", url+"/api/auth/register", map[string]string{"username": strings.ReplaceAll(name, " ", "_"), "password": "Test-only-password-123"})["success"].(bool) {
		t.Fatal("register")
	}
	if !call(t, c, "POST", url+"/api/me/pseudo", map[string]string{"pseudo": name})["success"].(bool) {
		t.Fatal("pseudo")
	}
}

func TestProfilesCircuitsPersistenceAndOrigin(t *testing.T) {
	a, s, c := newTest(t)
	login(t, c, s.URL, "Driver One")
	r := call(t, c, "POST", s.URL+"/api/circuits", map[string]string{"name": "Test course", "data": "encoded-track-data"})
	if r["success"] != true {
		t.Fatal(r)
	}
	key := r["data"].(map[string]any)["id"].(string)
	if call(t, c, "POST", s.URL+"/api/circuits/"+key+"/star", map[string]any{})["success"] != true {
		t.Fatal("star")
	}
	restored, err := New(fstest.MapFS{}, a.data)
	if err != nil || len(restored.store.Circuits) != 1 {
		t.Fatal("persistence", err)
	}
	r = call(t, c, "GET", s.URL+"/api/circuits/"+key, nil)
	if r["data"].(map[string]any)["data"] != "encoded-track-data" {
		t.Fatal("track data")
	}
	req, _ := http.NewRequest("POST", s.URL+"/api/me/pseudo", strings.NewReader(`{"pseudo":"Attacker"}`))
	req.Header.Set("Origin", "https://elsewhere.invalid")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("origin protection")
	}
	if call(t, c, "DELETE", s.URL+"/api/circuits/"+key, nil)["success"] != true {
		t.Fatal("delete")
	}
}
func TestLapGhostAndRanking(t *testing.T) {
	_, s, c := newTest(t)
	login(t, c, s.URL, "Rally Driver")
	ghost := map[string]any{"v": 1, "rate": 20, "data": make([]int, 21*8)}
	submit := func(seconds float64) map[string]any {
		return call(t, c, "POST", s.URL+"/api/tracks/default/laps", map[string]any{"time": seconds, "car": "Audi Quattro S1", "color": 1, "ghost": ghost})
	}
	if submit(1)["success"] != true {
		t.Fatal("valid ghost")
	}
	if submit(100)["success"] != false {
		t.Fatal("duration mismatch")
	}
	r := call(t, c, "GET", s.URL+"/api/tracks/default/leaderboard", nil)
	entries := r["data"].(map[string]any)["entries"].([]any)
	if len(entries) != 1 {
		t.Fatal("ranking")
	}
	if call(t, c, "GET", s.URL+"/api/tracks/default/ghost", nil)["success"] != true {
		t.Fatal("record ghost")
	}
}
func wsRead(t *testing.T, ctx context.Context, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	for {
		_, raw, e := c.Read(ctx)
		if e != nil {
			t.Fatal(e)
		}
		var m map[string]any
		json.Unmarshal(raw, &m)
		if m["t"] == kind {
			return m
		}
	}
}
func wsSend(t *testing.T, ctx context.Context, c *websocket.Conn, m any) {
	t.Helper()
	raw, _ := json.Marshal(m)
	if err := c.Write(ctx, websocket.MessageText, raw); err != nil {
		t.Fatal(err)
	}
}
func TestTwoPlayerLobbyRaceAndStateRelay(t *testing.T) {
	a, s, c1 := newTest(t)
	jar, _ := cookiejar.New(nil)
	c2 := &http.Client{Jar: jar}
	login(t, c1, s.URL, "Racer One")
	login(t, c2, s.URL, "Racer Two")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
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
	wsSend(t, ctx, x, map[string]any{"t": "create", "mode": "classic"})
	m := wsRead(t, ctx, x, "lobby")
	l := m["lobby"].(map[string]any)
	code := l["code"].(string)
	wsSend(t, ctx, y, map[string]any{"t": "join", "code": code})
	wsRead(t, ctx, y, "lobby")
	for _, conn := range []*websocket.Conn{x, y} {
		wsSend(t, ctx, conn, map[string]any{"t": "ready", "ready": true, "car": "Audi Quattro S1", "color": 1})
	}
	// Consume to confirm both ready before changing phase.
	for {
		m = wsRead(t, ctx, x, "lobby")
		players := m["lobby"].(map[string]any)["players"].([]any)
		n := 0
		for _, p := range players {
			if p.(map[string]any)["ready"] == true {
				n++
			}
		}
		if n == 2 {
			break
		}
	}
	wsSend(t, ctx, x, map[string]any{"t": "startVote"})
	for {
		m = wsRead(t, ctx, x, "lobby")
		if m["lobby"].(map[string]any)["state"] == "voting" {
			break
		}
	}
	a.hub.mu.Lock()
	room := a.hub.rooms[code]
	a.hub.closeVote(room)
	a.hub.startRace(room)
	room.Race.StartAt = time.Now().Add(-10 * time.Second).UnixMilli()
	a.hub.mu.Unlock()
	wsSend(t, ctx, x, map[string]any{"t": "state", "rt": 1, "x": 10, "z": 20, "qw": 1, "p": .5})
	state := wsRead(t, ctx, y, "states")
	if len(state["states"].([]any)) != 1 {
		t.Fatal("state relay")
	}
	wsSend(t, ctx, x, map[string]any{"t": "finish", "time": 9, "p": 1})
	wsSend(t, ctx, y, map[string]any{"t": "finish", "time": 9.1, "p": 1})
	for {
		m = wsRead(t, ctx, x, "lobby")
		if m["lobby"].(map[string]any)["state"] == "results" {
			break
		}
	}
	results := m["lobby"].(map[string]any)["race"].(map[string]any)["results"].([]any)
	if len(results) != 2 {
		t.Fatal("podium")
	}
}
func TestStaticWasmMime(t *testing.T) {
	a, err := New(fstest.MapFS{"physics.wasm": &fstest.MapFile{Data: []byte{0, 97, 115, 109}}}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	a.ServeHTTP(r, httptest.NewRequest("GET", "/physics.wasm", nil))
	if r.Header().Get("Content-Type") != "application/wasm" {
		t.Fatal("wasm MIME")
	}
}

func TestPasswordLoginSessionRevocationAndHash(t *testing.T) {
	a, s, c := newTest(t)
	body := map[string]string{"username": "TestDriver", "password": "Test-only-password-123", "next": "https://elsewhere.invalid"}
	r := call(t, c, "POST", s.URL+"/api/auth/register", body)
	if r["success"] != true {
		t.Fatal(r)
	}
	data := r["data"].(map[string]any)
	if data["url"] != "/index.html" {
		t.Fatal("open redirect")
	}
	accountID := data["account"].(map[string]any)["id"]
	if call(t, c, "POST", s.URL+"/api/auth/register", body)["success"] != false {
		t.Fatal("duplicate username")
	}
	if call(t, c, "POST", s.URL+"/api/auth/login", map[string]string{"username": "testdriver", "password": "wrong-password"})["success"] != false {
		t.Fatal("wrong password accepted")
	}
	if call(t, c, "POST", s.URL+"/api/auth/login", body)["success"] != true {
		t.Fatal("password login")
	}
	req, _ := http.NewRequest("GET", s.URL+"/api/me", nil)
	cookies := c.Jar.Cookies(req.URL)
	if len(cookies) != 1 {
		t.Fatal("session cookie")
	}
	old := *cookies[0]
	if call(t, c, "POST", s.URL+"/api/auth/sign-out", nil)["success"] != true {
		t.Fatal("logout")
	}
	req.AddCookie(&old)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatal("revoked session still accepted")
	}
	jar, _ := cookiejar.New(nil)
	other := &http.Client{Jar: jar}
	logged := call(t, other, "POST", s.URL+"/api/auth/login", map[string]string{"username": "TESTDRIVER", "password": "Test-only-password-123"})
	if logged["success"] != true || logged["data"].(map[string]any)["account"].(map[string]any)["id"] != accountID {
		t.Fatal("cross-device login")
	}
	a.mu.Lock()
	cred := a.store.Credentials["testdriver"]
	a.mu.Unlock()
	if cred.Hash == body["password"] || len(cred.Salt) != 32 || cred.Iterations != 600000 {
		t.Fatal("password storage")
	}
	restored, err := New(fstest.MapFS{}, a.data)
	if err != nil {
		t.Fatal(err)
	}
	rr := httptest.NewRecorder()
	restored.ServeHTTP(rr, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"username":"TestDriver","password":"Test-only-password-123"}`)))
	if rr.Code != 200 {
		t.Fatal("login after restart", rr.Body.String())
	}
}
