package server

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

type Account struct {
	ID       string `json:"id"`
	Pseudo   string `json:"pseudo"`
	Username string `json:"username"`
}
type Circuit struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Data   string          `json:"data"`
	Shape  string          `json:"shape"`
	Author string          `json:"author"`
	Owner  string          `json:"owner"`
	Date   string          `json:"date"`
	Stars  map[string]bool `json:"stars"`
}
type Lap struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Time  float64         `json:"time"`
	Car   string          `json:"car"`
	Color int             `json:"color"`
	Ghost json.RawMessage `json:"ghost"`
	Date  string          `json:"date"`
	Rank  int             `json:"rank,omitempty"`
}
type Store struct {
	Credentials map[string]Credential `json:"credentials"`
	Sessions    map[string]Session    `json:"sessions"`
	Accounts    map[string]*Account   `json:"accounts"`
	Circuits    map[string]*Circuit   `json:"circuits"`
	Laps        map[string][]Lap      `json:"laps"`
}
type App struct {
	mu            sync.Mutex
	store         Store
	data          string
	static        http.Handler
	hub           *Hub
	loginAttempts map[string]*attempts
}

func New(files fs.FS, data string) (*App, error) {
	if err := os.MkdirAll(data, 0700); err != nil {
		return nil, err
	}
	a := &App{data: data, store: Store{Accounts: map[string]*Account{}, Circuits: map[string]*Circuit{}, Laps: map[string][]Lap{}}, static: http.FileServer(http.FS(files))}
	raw, err := os.ReadFile(filepath.Join(data, "store.json"))
	if err == nil {
		if err = json.Unmarshal(raw, &a.store); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if a.store.Accounts == nil {
		a.store.Accounts = map[string]*Account{}
	}
	if a.store.Credentials == nil {
		a.store.Credentials = map[string]Credential{}
	}
	if a.store.Sessions == nil {
		a.store.Sessions = map[string]Session{}
	}
	if a.store.Circuits == nil {
		a.store.Circuits = map[string]*Circuit{}
	}
	if a.store.Laps == nil {
		a.store.Laps = map[string][]Lap{}
	}
	a.loginAttempts = map[string]*attempts{}
	// Retain only the three promoted public circuits, not personal data or records.
	if seed, err := fs.ReadFile(files, "seed-circuits.json"); err == nil {
		var envelope struct {
			Data struct {
				Circuits []struct{ ID, Name, Data, Shape, Author, Date string } `json:"circuits"`
			} `json:"data"`
		}
		if json.Unmarshal(seed, &envelope) == nil {
			for _, c := range envelope.Data.Circuits {
				if _, ok := a.store.Circuits[c.ID]; !ok {
					a.store.Circuits[c.ID] = &Circuit{ID: c.ID, Name: c.Name, Data: c.Data, Shape: c.Shape, Author: c.Author, Date: c.Date, Stars: map[string]bool{}}
				}
			}
		}
	}
	a.hub = newHub(a)
	return a, nil
}
func id(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func (a *App) saveLocked() error {
	raw, err := json.Marshal(a.store)
	if err != nil {
		return err
	}
	tmp := filepath.Join(a.data, "store.json.tmp")
	if err = os.WriteFile(tmp, raw, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(a.data, "store.json"))
}
func success(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(map[string]any{"success": true, "data": data})
}
func failure(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]any{"success": false, "error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if json.NewDecoder(r.Body).Decode(v) != nil {
		failure(w, 400, "Invalid JSON")
		return false
	}
	return true
}
func (a *App) accountLocked(r *http.Request) *Account {
	c, err := r.Cookie("dirtbound-session")
	if err != nil {
		return nil
	}
	session, ok := a.store.Sessions[sessionKey(c.Value)]
	if !ok || session.Expires < time.Now().Unix() {
		return nil
	}
	return a.store.Accounts[session.Account]
}
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	if strings.HasPrefix(r.URL.Path, "/api/") {
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if origin := r.Header.Get("Origin"); origin != "" {
				u, e := url.Parse(origin)
				if e != nil || u.Host != r.Host {
					failure(w, 403, "Cross-origin request refused")
					return
				}
			}
		}
		if r.URL.Path == "/api/lobby" {
			a.hub.socket(w, r)
			return
		}
		a.api(w, r)
		return
	}
	if strings.HasSuffix(r.URL.Path, ".wasm") {
		w.Header().Set("Content-Type", "application/wasm")
	}
	if strings.HasSuffix(r.URL.Path, ".js") {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	}
	if r.URL.Path == "/healthz" {
		success(w, map[string]string{"status": "ok", "physics": "go-wasm", "version": "1"})
		return
	}
	if strings.Contains(r.URL.Path, "/.") || strings.HasSuffix(r.URL.Path, ".go") {
		http.NotFound(w, r)
		return
	}
	a.static.ServeHTTP(w, r)
}

var namePattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,19}$`)

func (a *App) api(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	me := a.accountLocked(r)
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/")
	switch path {
	case "stats":
		w.WriteHeader(204)
		return
	case "online":
		success(w, map[string]int{"players": a.hub.online()})
		return
	case "me":
		if me == nil {
			failure(w, 401, "Sign in first")
		} else {
			success(w, me)
		}
		return
	case "auth/register", "auth/login":
		a.authenticate(w, r, path)
		return
	case "auth/sign-out":
		if r.Method != "POST" {
			failure(w, 405, "POST required")
			return
		}
		if c, err := r.Cookie("dirtbound-session"); err == nil {
			delete(a.store.Sessions, sessionKey(c.Value))
		}
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "dirtbound-session", Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, MaxAge: -1})
		if me != nil {
			a.hub.mu.Lock()
			if p := a.hub.peers[me.ID]; p != nil {
				go p.conn.Close(4001, "Signed out")
			}
			a.hub.mu.Unlock()
		}
		success(w, map[string]bool{"signedOut": true})
		return
	case "me/pseudo":
		if r.Method != "POST" {
			failure(w, 405, "POST required")
			return
		}
		if me == nil {
			failure(w, 401, "Sign in first")
			return
		}
		var b struct {
			Pseudo   string `json:"pseudo"`
			Username string `json:"username"`
		}
		if !decode(w, r, &b) {
			return
		}
		b.Pseudo = strings.TrimSpace(b.Pseudo)
		if !namePattern.MatchString(b.Pseudo) {
			failure(w, 400, "Use 2–20 letters or digits")
			return
		}
		me.Pseudo = b.Pseudo
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		success(w, me)
		return
	}
	parts := strings.Split(path, "/")
	if parts[0] == "circuits" {
		a.circuits(w, r, parts, me)
		return
	}
	if len(parts) == 3 && parts[0] == "tracks" {
		a.tracks(w, r, parts, me)
		return
	}
	failure(w, 404, "Unknown endpoint")
}
func (c *Circuit) view(me *Account, full bool) map[string]any {
	mine, starred := false, false
	if me != nil {
		mine = c.Owner == me.ID
		starred = c.Stars[me.ID]
	}
	v := map[string]any{"id": c.ID, "name": c.Name, "shape": c.Shape, "author": c.Author, "date": c.Date, "stars": len(c.Stars), "mine": mine, "starred": starred}
	if full {
		v["data"] = c.Data
	}
	return v
}
func (a *App) circuits(w http.ResponseWriter, r *http.Request, p []string, me *Account) {
	if len(p) == 1 && r.Method == "GET" {
		items := []map[string]any{}
		for _, c := range a.store.Circuits {
			items = append(items, c.view(me, false))
		}
		sort.Slice(items, func(i, j int) bool { return items[i]["date"].(string) > items[j]["date"].(string) })
		success(w, map[string]any{"circuits": items})
		return
	}
	if len(p) == 1 && r.Method == "POST" {
		if me == nil || me.Pseudo == "" {
			failure(w, 401, "Choose a profile name first")
			return
		}
		var b struct{ Name, Data, Replaces string }
		if !decode(w, r, &b) {
			return
		}
		b.Name = strings.TrimSpace(b.Name)
		if utf8.RuneCountInString(b.Name) < 1 || utf8.RuneCountInString(b.Name) > 60 || len(b.Data) < 5 || len(b.Data) > 200000 {
			failure(w, 400, "Invalid circuit")
			return
		}
		hash := sha256.Sum256([]byte("spline." + b.Data))
		key := hex.EncodeToString(hash[:])
		if old := a.store.Circuits[key]; old != nil && old.Owner != me.ID {
			failure(w, 409, "Circuit already published")
			return
		}
		stars := map[string]bool{}
		if b.Replaces != "" {
			old := a.store.Circuits[b.Replaces]
			if old == nil || old.Owner != me.ID {
				failure(w, 403, "Not your circuit")
				return
			}
			stars = old.Stars
			delete(a.store.Circuits, b.Replaces)
		}
		c := &Circuit{ID: key, Name: b.Name, Data: b.Data, Shape: b.Data, Author: me.Pseudo, Owner: me.ID, Date: time.Now().UTC().Format(time.RFC3339), Stars: stars}
		a.store.Circuits[key] = c
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		success(w, c.view(me, true))
		return
	}
	if len(p) < 2 {
		failure(w, 405, "Method not allowed")
		return
	}
	c := a.store.Circuits[p[1]]
	if c == nil {
		failure(w, 404, "Circuit not found")
		return
	}
	if len(p) == 2 && r.Method == "GET" {
		success(w, c.view(me, true))
		return
	}
	if me == nil {
		failure(w, 401, "Sign in first")
		return
	}
	if len(p) == 2 && r.Method == "DELETE" {
		if c.Owner != me.ID {
			failure(w, 403, "Not your circuit")
			return
		}
		delete(a.store.Circuits, c.ID)
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		success(w, map[string]bool{"deleted": true})
		return
	}
	if len(p) == 3 && p[2] == "star" && r.Method == "POST" {
		if c.Stars == nil {
			c.Stars = map[string]bool{}
		}
		if c.Stars[me.ID] {
			delete(c.Stars, me.ID)
		} else {
			c.Stars[me.ID] = true
		}
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		success(w, c.view(me, false))
		return
	}
	failure(w, 405, "Method not allowed")
}
func (a *App) tracks(w http.ResponseWriter, r *http.Request, p []string, me *Account) {
	key, action := p[1], p[2]
	if len(key) > 128 {
		failure(w, 400, "Invalid track id")
		return
	}
	laps := a.store.Laps[key]
	if action == "leaderboard" && r.Method == "GET" {
		entries := []Lap{}
		var mine *Lap
		for i, lap := range laps {
			lap.Rank = i + 1
			lap.Ghost = nil
			entries = append(entries, lap)
			if me != nil && lap.ID == me.ID {
				v := lap
				mine = &v
			}
		}
		success(w, map[string]any{"entries": entries, "total": len(entries), "mine": mine})
		return
	}
	if action == "ghost" && r.Method == "GET" {
		if len(laps) == 0 {
			failure(w, 404, "No record yet")
			return
		}
		success(w, laps[0])
		return
	}
	if (action == "laps" || action == "archive") && r.Method == "POST" {
		if me == nil || me.Pseudo == "" {
			failure(w, 401, "Choose a profile name first")
			return
		}
		var lap Lap
		if !decode(w, r, &lap) {
			return
		}
		if math.IsNaN(lap.Time) || math.IsInf(lap.Time, 0) || lap.Time < 1 || lap.Time > 86400 || len(lap.Ghost) == 0 || len(lap.Car) > 100 {
			failure(w, 400, "Invalid lap")
			return
		}
		if err := validateGhost(lap.Ghost, lap.Time); err != nil {
			failure(w, 400, err.Error())
			return
		}
		lap.ID = me.ID
		lap.Name = me.Pseudo
		lap.Date = time.Now().UTC().Format(time.RFC3339)
		if action == "archive" {
			success(w, map[string]bool{"archived": false})
			return
		}
		next := []Lap{}
		improved := true
		for _, old := range laps {
			if old.ID == me.ID {
				if old.Time <= lap.Time {
					improved = false
					next = append(next, old)
				}
			} else {
				next = append(next, old)
			}
		}
		if improved {
			next = append(next, lap)
		}
		sort.Slice(next, func(i, j int) bool { return next[i].Time < next[j].Time })
		if len(next) > 500 {
			next = next[:500]
		}
		a.store.Laps[key] = next
		if a.saveLocked() != nil {
			failure(w, 500, "Storage unavailable")
			return
		}
		rank := 0
		for i, l := range next {
			if l.ID == me.ID {
				rank = i + 1
			}
		}
		success(w, map[string]any{"improved": improved, "rank": rank, "time": lap.Time})
		return
	}
	failure(w, 405, "Method not allowed")
}
