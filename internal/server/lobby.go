package server

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type Player struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Car       string `json:"car"`
	Color     int    `json:"color"`
	Ready     bool   `json:"ready"`
	Connected bool   `json:"connected"`
}
type LobbySettings struct {
	Yaris      bool   `json:"yaris"`
	Laps       int    `json:"laps"`
	Length     int    `json:"length"`
	Collisions bool   `json:"collisions"`
	Landscape  string `json:"landscape"`
	Camera     string `json:"camera"`
}
type Choice struct {
	Kind string `json:"kind"`
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`
}
type Finish struct {
	ID   string   `json:"id"`
	Name string   `json:"name"`
	Time *float64 `json:"time"`
}
type Race struct {
	Yaris bool `json:"yaris"`
	Choice
	Mode       string             `json:"mode"`
	Seed       string             `json:"seed,omitempty"`
	Laps       int                `json:"laps"`
	Length     int                `json:"length"`
	Landscape  string             `json:"landscape"`
	Camera     string             `json:"camera"`
	Collisions bool               `json:"collisions"`
	Bonus      bool               `json:"bonus"`
	Grid       []*Player          `json:"grid"`
	StartAt    int64              `json:"startAt"`
	Finishes   map[string]float64 `json:"finishes"`
	Results    []Finish           `json:"results"`
	Loaded     map[string]bool    `json:"-"`
}
type Lobby struct {
	Code       string            `json:"code"`
	Name       string            `json:"name"`
	Mode       string            `json:"mode"`
	Visibility string            `json:"visibility"`
	Host       string            `json:"host"`
	State      string            `json:"state"`
	Players    []*Player         `json:"players"`
	Settings   LobbySettings     `json:"settings"`
	Votes      map[string]Choice `json:"votes"`
	Deadline   int64             `json:"deadline"`
	Race       *Race             `json:"race"`
}
type peer struct {
	beta                  bool
	conn                  *websocket.Conn
	send                  chan []byte
	id, name, room, watch string
	lastState             time.Time
	lastFire              time.Time
}
type Hub struct {
	mu    sync.Mutex
	app   *App
	rooms map[string]*Lobby
	peers map[string]*peer
}

func forceYaris(l *Lobby) {
	if l.Mode != "yaris" && !l.Settings.Yaris {
		return
	}
	for _, player := range l.Players {
		player.Car = "Toyota Yaris"
		player.Color = 1
	}
}

func newHub(a *App) *Hub   { return &Hub{app: a, rooms: map[string]*Lobby{}, peers: map[string]*peer{}} }
func (h *Hub) online() int { h.mu.Lock(); defer h.mu.Unlock(); return len(h.peers) }
func (p *peer) emit(msg any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	select {
	case p.send <- raw:
	default:
		go p.conn.Close(websocket.StatusPolicyViolation, "Slow consumer")
	}
}

// Close codes of a socket accepted only to be refused (see socket).
const (
	closeSignIn        websocket.StatusCode = 4001
	closeOtherTab      websocket.StatusCode = 4000
	closeTryAgainLater websocket.StatusCode = 1013
)

func (h *Hub) socket(w http.ResponseWriter, r *http.Request) {
	a, authErr := h.app.account(r)
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	// Refusals happen after the upgrade: Firefox delays every later handshake
	// to this URL (up to 60 s) after each one answered with an HTTP error.
	if authErr != nil {
		log.Printf("lobby socket refused: database operation failed (%T)", authErr)
		conn.Close(closeTryAgainLater, "Storage unavailable")
		return
	}
	var user Account
	if a != nil {
		user = *a
	}
	if user.ID == "" || user.Pseudo == "" {
		conn.Close(closeSignIn, "Choose a profile name first")
		return
	}
	conn.SetReadLimit(65536)
	p := &peer{conn: conn, send: make(chan []byte, 128), id: user.ID, name: user.Pseudo, beta: user.Beta}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	defer conn.CloseNow()
	h.mu.Lock()
	if old := h.peers[p.id]; old != nil {
		p.room = old.room
		go old.conn.Close(closeOtherTab, "Connected from another tab")
	}
	h.peers[p.id] = p
	// Navigation from the menu to play.html closes the old WebSocket before
	// the next page opens one. Recover membership from the retained lobby.
	if p.room == "" {
		for code, room := range h.rooms {
			for _, pl := range room.Players {
				if pl.ID == p.id {
					p.room = code
					break
				}
			}
			if p.room != "" {
				break
			}
		}
	}
	if room := h.rooms[p.room]; room != nil {
		for _, pl := range room.Players {
			if pl.ID == p.id {
				pl.Connected = true
				pl.Name = p.name
			}
		}
	}
	h.mu.Unlock()
	go func() {
		for {
			select {
			case raw := <-p.send:
				c, done := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Write(c, websocket.MessageText, raw)
				done()
				if err != nil {
					cancel()
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if h.peers[p.id] != p {
			return
		}
		delete(h.peers, p.id)
		if l := h.rooms[p.room]; l != nil {
			for _, pl := range l.Players {
				if pl.ID == p.id {
					pl.Connected = false
				}
			}
			h.broadcast(l)
		}
		time.AfterFunc(20*time.Second, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if _, ok := h.peers[p.id]; !ok {
				h.leave(p)
			}
		})
	}()
	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) != nil {
			continue
		}
		h.mu.Lock()
		if h.peers[p.id] != p {
			h.mu.Unlock()
			return
		}
		h.handle(p, m)
		h.mu.Unlock()
	}
}
func str(m map[string]json.RawMessage, k string) string {
	var v string
	json.Unmarshal(m[k], &v)
	return v
}
func number(m map[string]json.RawMessage, k string) float64 {
	var v float64
	json.Unmarshal(m[k], &v)
	return v
}
func boolean(m map[string]json.RawMessage, k string) bool {
	var v bool
	json.Unmarshal(m[k], &v)
	return v
}
func (h *Hub) err(p *peer, msg string) { p.emit(map[string]any{"t": "error", "message": msg}) }
func (h *Hub) sendLobby(p *peer, l *Lobby) {
	p.emit(map[string]any{"t": "lobby", "lobby": l, "you": p.id})
}
func (h *Hub) broadcast(l *Lobby) {
	for _, p := range h.peers {
		if p.room == l.Code {
			h.sendLobby(p, l)
		}
	}
	h.listAll()
}
func (h *Hub) list(p *peer) {
	items := []map[string]any{}
	for _, l := range h.rooms {
		if l.Visibility != "public" || l.Mode != p.watch {
			continue
		}
		host := ""
		for _, pl := range l.Players {
			if pl.ID == l.Host {
				host = pl.Name
			}
		}
		items = append(items, map[string]any{"code": l.Code, "name": l.Name, "host": host, "players": len(l.Players), "max": 8, "state": l.State})
	}
	p.emit(map[string]any{"t": "lobbies", "mode": p.watch, "lobbies": items})
}
func (h *Hub) listAll() {
	for _, p := range h.peers {
		if p.watch != "" {
			h.list(p)
		}
	}
}
func (h *Hub) leave(p *peer) {
	l := h.rooms[p.room]
	p.room = ""
	if l == nil {
		return
	}
	next := []*Player{}
	for _, pl := range l.Players {
		if pl.ID != p.id {
			next = append(next, pl)
		}
	}
	l.Players = next
	delete(l.Votes, p.id)
	if len(next) == 0 {
		delete(h.rooms, l.Code)
		h.listAll()
		return
	}
	if l.Host == p.id {
		l.Host = next[0].ID
	}
	h.broadcast(l)
}
func (h *Hub) handle(p *peer, m map[string]json.RawMessage) {
	t := str(m, "t")
	l := h.rooms[p.room]
	switch t {
	case "hello":
		// player null: this account has no lobby here (gone, or never joined)
		if l == nil {
			p.emit(map[string]any{"t": "welcome", "player": nil})
			return
		}
		p.emit(map[string]any{"t": "welcome", "player": p.id})
		h.sendLobby(p, l)
		return
	case "ping":
		p.emit(map[string]any{"t": "pong", "c": number(m, "c"), "s": time.Now().UnixMilli()})
		return
	case "watch":
		p.watch = str(m, "mode")
		if p.watch == "beta" && !p.beta {
			h.err(p, "Нужен доступ бетатестера.")
			return
		}
		h.list(p)
		return
	case "create":
		if str(m, "mode") == "beta" && !p.beta {
			h.err(p, "Нужен доступ бетатестера.")
			return
		}
		if len(h.rooms) >= 2000 {
			h.err(p, "Server full")
			return
		}
		h.leave(p)
		code := ""
		alphabet := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
		for {
			raw := id(5)
			for i := 0; i < 5; i++ {
				code += string(alphabet[int(raw[i])%len(alphabet)])
			}
			if h.rooms[code] == nil {
				break
			}
			code = ""
		}
		mode := str(m, "mode")
		if mode != "bonus" && mode != "yaris" && mode != "beta" {
			mode = "classic"
		}
		visibility := str(m, "visibility")
		if visibility != "public" {
			visibility = "private"
		}
		name := strings.TrimSpace(str(m, "name"))
		if len(name) > 96 {
			name = name[:96]
		}
		if name == "" {
			name = p.name
		}
		l = &Lobby{Code: code, Name: name, Mode: mode, Visibility: visibility, Host: p.id, State: "waiting", Players: []*Player{{ID: p.id, Name: p.name, Car: "Audi Quattro S1", Color: 1, Connected: true}}, Settings: LobbySettings{Laps: 3, Length: 3000, Landscape: "varied", Camera: "iso", Yaris: boolean(m, "yaris")}, Votes: map[string]Choice{}}
		forceYaris(l)
		h.rooms[code] = l
		p.room = code
		h.broadcast(l)
		return
	case "join":
		code := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(str(m, "code"), " ", ""), "-", ""))
		target := h.rooms[code]
		if target == nil || target.State != "waiting" || len(target.Players) >= 8 {
			h.err(p, "Lobby unavailable")
			return
		}
		if target.Mode == "beta" && !p.beta {
			h.err(p, "Нужен доступ бетатестера.")
			return
		}
		h.leave(p)
		p.room = code
		target.Players = append(target.Players, &Player{ID: p.id, Name: p.name, Car: "Audi Quattro S1", Color: 1, Connected: true})
		forceYaris(target)
		h.broadcast(target)
		return
	case "leave":
		h.leave(p)
		p.emit(map[string]string{"t": "left", "reason": ""})
		return
	}
	if l == nil {
		h.err(p, "Not in a lobby")
		return
	}
	switch t {
	case "car":
		if l.State != "waiting" {
			return
		}
		for _, pl := range l.Players {
			if pl.ID == p.id {
				if car := str(m, "car"); len(car) > 0 && len(car) < 100 {
					pl.Car = car
				}
				pl.Color = int(math.Max(1, math.Min(5, number(m, "color"))))
				pl.Ready = false
			}
		}
		forceYaris(l)
		h.broadcast(l)
	case "ready":
		if l.State != "waiting" {
			return
		}
		for _, pl := range l.Players {
			if pl.ID == p.id {
				pl.Ready = boolean(m, "ready")
				car := str(m, "car")
				if len(car) > 0 && len(car) < 100 {
					pl.Car = car
				}
				color := int(number(m, "color"))
				if color >= 1 && color <= 5 {
					pl.Color = color
				}
			}
		}
		forceYaris(l)
		h.broadcast(l)
	case "settings":
		if l.Host != p.id || l.State != "waiting" {
			return
		}
		s := l.Settings
		if _, ok := m["yaris"]; ok {
			s.Yaris = boolean(m, "yaris")
			for _, pl := range l.Players {
				pl.Ready = false
			}
		}
		if _, ok := m["laps"]; ok {
			s.Laps = int(math.Max(1, math.Min(10, number(m, "laps"))))
		}
		if _, ok := m["length"]; ok {
			s.Length = int(math.Max(1000, math.Min(10000, number(m, "length"))))
		}
		if _, ok := m["collisions"]; ok {
			s.Collisions = boolean(m, "collisions")
		}
		if v := str(m, "camera"); v == "iso" || v == "chase" || v == "both" {
			s.Camera = v
		}
		if v := str(m, "landscape"); v == "low" || v == "high" || v == "varied" {
			s.Landscape = v
		}
		l.Settings = s
		forceYaris(l)
		h.broadcast(l)
	case "kick":
		if l.Host != p.id || str(m, "player") == p.id {
			return
		}
		if victim := h.peers[str(m, "player")]; victim != nil && victim.room == l.Code {
			h.leave(victim)
			victim.emit(map[string]string{"t": "left", "reason": "Removed by host"})
		}
	case "startVote":
		if l.Host != p.id || l.State != "waiting" {
			return
		}
		ready := 0
		for _, pl := range l.Players {
			if pl.Ready && pl.Connected {
				ready++
			}
		}
		if ready < 2 {
			h.err(p, "Two ready players required")
			return
		}
		l.State = "voting"
		l.Deadline = time.Now().Add(12 * time.Second).UnixMilli()
		l.Votes = map[string]Choice{}
		h.broadcast(l)
		code := l.Code
		time.AfterFunc(12*time.Second, func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			if room := h.rooms[code]; room != nil && room.State == "voting" {
				h.closeVote(room)
			}
		})
	case "vote":
		if l.State != "voting" {
			return
		}
		choice := Choice{Kind: str(m, "kind"), ID: str(m, "id")}
		if choice.Kind != "official" && choice.Kind != "circuit" && choice.Kind != "rally" && choice.Kind != "loop" {
			return
		}
		if l.Mode == "bonus" && (choice.Kind == "rally" || choice.Kind == "loop") {
			return
		}
		if len(choice.ID) > 128 {
			return
		}
		l.Votes[p.id] = choice
		h.broadcast(l)
	case "loaded":
		if l.Race == nil || l.State != "loading" {
			return
		}
		l.Race.Loaded[p.id] = true
		all := true
		for _, g := range l.Race.Grid {
			if !l.Race.Loaded[g.ID] {
				all = false
			}
		}
		if all {
			h.startRace(l)
		}
	case "state":
		if l.State != "racing" || time.Since(p.lastState) < 25*time.Millisecond {
			return
		}
		p.lastState = time.Now()
		state := map[string]any{"id": p.id}
		for _, key := range []string{"rt", "x", "y", "z", "qx", "qy", "qz", "qw", "st", "sp", "p"} {
			v := number(m, key)
			if math.IsNaN(v) || math.IsInf(v, 0) || math.Abs(v) > 1e7 {
				return
			}
			state[key] = v
		}
		for _, other := range h.peers {
			if other.room == p.room && other.id != p.id {
				other.emit(map[string]any{"t": "states", "states": []any{state}})
			}
		}
	case "finish":
		if l.State != "racing" || l.Race == nil {
			return
		}
		elapsed := float64(time.Now().UnixMilli()-l.Race.StartAt) / 1000
		result := number(m, "time")
		if result < 1 || result > elapsed+2 || number(m, "p") < .95 {
			h.err(p, "Invalid finish")
			return
		}
		if _, exists := l.Race.Finishes[p.id]; exists {
			return
		}
		l.Race.Finishes[p.id] = result
		all := len(l.Race.Finishes) >= len(l.Race.Grid)
		if all {
			h.results(l)
		} else {
			h.broadcast(l)
			code := l.Code
			race := l.Race
			time.AfterFunc(60*time.Second, func() {
				h.mu.Lock()
				defer h.mu.Unlock()
				if room := h.rooms[code]; room != nil && room.Race == race && room.State == "racing" {
					h.results(room)
				}
			})
		}
	case "fire", "hit":
		if l.State != "racing" || l.Race == nil || !l.Race.Bonus {
			return
		}
		if t == "fire" && time.Since(p.lastFire) < 500*time.Millisecond {
			return
		}
		p.lastFire = time.Now()
		msg := map[string]any{}
		for k, v := range m {
			msg[k] = v
		}
		msg["id"] = p.id
		for _, other := range h.peers {
			if other.room == p.room && other.id != p.id {
				other.emit(msg)
			}
		}
	}
}
func (h *Hub) closeVote(l *Lobby) {
	forceYaris(l)
	counts := map[Choice]int{}
	winner := Choice{Kind: "official", ID: "default"}
	best := 0
	// Player order breaks ties deterministically.
	for _, pl := range l.Players {
		if c, ok := l.Votes[pl.ID]; ok {
			counts[c]++
			if counts[c] > best {
				winner = c
				best = counts[c]
			}
		}
	}
	if winner.Kind == "loop" {
		winner = Choice{Kind: "official", ID: "default"}
	}
	grid := []*Player{}
	for _, p := range l.Players {
		if p.Ready && p.Connected {
			copy := *p
			grid = append(grid, &copy)
		}
	}
	l.Race = &Race{Choice: winner, Mode: l.Mode, Yaris: l.Settings.Yaris || l.Mode == "yaris", Seed: id(8), Laps: l.Settings.Laps, Length: l.Settings.Length, Landscape: l.Settings.Landscape, Camera: l.Settings.Camera, Collisions: l.Settings.Collisions || l.Mode == "bonus", Bonus: l.Mode == "bonus", Grid: grid, Finishes: map[string]float64{}, Results: []Finish{}, Loaded: map[string]bool{}}
	l.State = "loading"
	l.Deadline = time.Now().Add(90 * time.Second).UnixMilli()
	h.broadcast(l)
	code := l.Code
	race := l.Race
	time.AfterFunc(90*time.Second, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if room := h.rooms[code]; room != nil && room.Race == race && room.State == "loading" {
			h.startRace(room)
		}
	})
}
func (h *Hub) startRace(l *Lobby) {
	l.State = "racing"
	l.Race.StartAt = time.Now().Add(4 * time.Second).UnixMilli()
	h.broadcast(l)
	code := l.Code
	race := l.Race
	time.AfterFunc(20*time.Minute, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if room := h.rooms[code]; room != nil && room.Race == race && room.State == "racing" {
			h.results(room)
		}
	})
}
func (h *Hub) results(l *Lobby) {
	results := []Finish{}
	for _, pl := range l.Race.Grid {
		f := Finish{ID: pl.ID, Name: pl.Name}
		if t, ok := l.Race.Finishes[pl.ID]; ok {
			v := t
			f.Time = &v
		}
		results = append(results, f)
	}
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Time == nil {
			return false
		}
		if results[j].Time == nil {
			return true
		}
		return *results[i].Time < *results[j].Time
	})
	l.Race.Results = results
	l.State = "results"
	h.broadcast(l)
	code := l.Code
	race := l.Race
	time.AfterFunc(15*time.Second, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if room := h.rooms[code]; room != nil && room.Race == race && room.State == "results" {
			room.State = "waiting"
			room.Race = nil
			room.Votes = map[string]Choice{}
			for _, p := range room.Players {
				p.Ready = false
			}
			h.broadcast(room)
		}
	})
}
