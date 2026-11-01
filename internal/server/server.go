package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"log"
	"math"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
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
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Data      string          `json:"data"`
	Shape     string          `json:"shape"`
	Author    string          `json:"author"`
	Owner     string          `json:"owner"`
	Date      string          `json:"date"`
	Stars     map[string]bool `json:"stars"`
	starCount int
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
	db            *pgxpool.Pool
	static        http.Handler
	hub           *Hub
	authMu        sync.Mutex
	loginAttempts map[string]*attempts
	authSlots     chan struct{}
}

func id(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
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
func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "same-origin")
	if path.Clean(r.URL.Path) == "/play.html" {
		me, err := a.account(r)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		signedIn := me != nil
		w.Header().Set("Cache-Control", "no-store")
		if !signedIn {
			http.Redirect(w, r, "/login.html?next="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			return
		}
	}
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
		ctx, cancel := context.WithTimeout(r.Context(), time.Second)
		defer cancel()
		if err := a.db.Ping(ctx); err != nil {
			databaseFailure(w, err)
			return
		}
		success(w, map[string]string{"status": "ok", "physics": "go-wasm", "storage": "postgresql", "version": "2"})
		return
	}
	if strings.Contains(r.URL.Path, "/.") || strings.HasSuffix(r.URL.Path, ".go") {
		http.NotFound(w, r)
		return
	}
	a.static.ServeHTTP(w, r)
}

var namePattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,19}$`)

func databaseFailure(w http.ResponseWriter, err error) {
	log.Printf("database operation failed (%T)", err)
	failure(w, 503, "Хранилище временно недоступно. Повторите запрос.")
}

func (a *App) api(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	r = r.WithContext(ctx)
	route := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/"), "/")
	if route == "auth/login" || route == "auth/register" {
		a.authenticate(w, r, route)
		return
	}
	if route == "stats" {
		w.WriteHeader(204)
		return
	}
	if route == "online" {
		success(w, map[string]int{"players": a.hub.online()})
		return
	}
	me, err := a.account(r)
	if err != nil {
		databaseFailure(w, err)
		return
	}
	switch route {
	case "me":
		if me == nil {
			failure(w, 401, "Sign in first")
		} else {
			success(w, me)
		}
		return
	case "me/dashboard":
		a.dashboard(w, r, me)
		return
	case "auth/sign-out":
		if r.Method != "POST" {
			failure(w, 405, "POST required")
			return
		}
		if c, e := r.Cookie("dirtbound-session"); e == nil {
			if _, err = a.db.Exec(ctx, "DELETE FROM sessions WHERE token_hash=$1", sessionKey(c.Value)); err != nil {
				databaseFailure(w, err)
				return
			}
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
		var body struct{ Pseudo string }
		if !decode(w, r, &body) {
			return
		}
		body.Pseudo = strings.TrimSpace(body.Pseudo)
		if !namePattern.MatchString(body.Pseudo) {
			failure(w, 400, "Use 2–20 letters or digits")
			return
		}
		if _, err = a.db.Exec(ctx, "UPDATE accounts SET pseudo=$1 WHERE id=$2", body.Pseudo, me.ID); err != nil {
			databaseFailure(w, err)
			return
		}
		me.Pseudo = body.Pseudo
		success(w, me)
		return
	}
	p := strings.Split(route, "/")
	if p[0] == "circuits" {
		a.circuits(w, r, p, me)
		return
	}
	if len(p) == 3 && p[0] == "tracks" {
		a.tracks(w, r, p, me)
		return
	}
	failure(w, 404, "Unknown endpoint")
}

func (c *Circuit) view(me *Account, full bool) map[string]any {
	v := map[string]any{"id": c.ID, "name": c.Name, "shape": c.Shape, "author": c.Author, "date": c.Date, "stars": c.starCount, "mine": me != nil && c.Owner == me.ID, "starred": me != nil && c.Stars[me.ID]}
	if full {
		v["data"] = c.Data
	}
	return v
}

func paging(r *http.Request) (int, int) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 100
	}
	if limit > 100 {
		limit = 100
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		page = 10000
	}
	return page, limit
}

func (a *App) circuits(w http.ResponseWriter, r *http.Request, p []string, me *Account) {
	ctx := r.Context()
	user := accountID(me)
	if len(p) == 1 && r.Method == "GET" {
		page, limit := paging(r)
		owner := ""
		if r.URL.Query().Get("mine") == "1" {
			if me == nil {
				failure(w, 401, "Sign in first")
				return
			}
			owner = user
		}
		var total int
		if err := a.db.QueryRow(ctx, `SELECT count(*) FROM circuits WHERE ($1='' OR owner=$1)`, owner).Scan(&total); err != nil {
			databaseFailure(w, err)
			return
		}
		rows, err := a.db.Query(ctx, `SELECT `+circuitSummaryColumns+` FROM circuits c WHERE ($2='' OR c.owner=$2) ORDER BY c.date DESC,c.id LIMIT $3 OFFSET $4`, user, owner, limit, (page-1)*limit)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		defer rows.Close()
		items := []map[string]any{}
		for rows.Next() {
			c, e := scanCircuit(rows, user)
			if e != nil {
				databaseFailure(w, e)
				return
			}
			items = append(items, c.view(me, false))
		}
		if rows.Err() != nil {
			databaseFailure(w, rows.Err())
			return
		}
		success(w, map[string]any{"circuits": items, "total": total, "page": page, "pageSize": limit})
		return
	}
	if len(p) == 1 && r.Method == "POST" {
		if me == nil || me.Pseudo == "" {
			failure(w, 401, "Choose a profile name first")
			return
		}
		var body struct{ Name, Data, Replaces string }
		if !decode(w, r, &body) {
			return
		}
		body.Name = strings.TrimSpace(body.Name)
		if utf8.RuneCountInString(body.Name) < 1 || utf8.RuneCountInString(body.Name) > 60 || len(body.Data) < 5 || len(body.Data) > 200000 {
			failure(w, 400, "Invalid circuit")
			return
		}
		sum := sha256.Sum256([]byte("spline." + body.Data))
		key := hex.EncodeToString(sum[:])
		tx, err := a.db.Begin(ctx)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		defer tx.Rollback(context.Background())
		if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", user); err != nil {
			databaseFailure(w, err)
			return
		}
		if body.Replaces != "" {
			var owner string
			err = tx.QueryRow(ctx, "SELECT COALESCE(owner,'') FROM circuits WHERE id=$1 FOR UPDATE", body.Replaces).Scan(&owner)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && owner != user {
				failure(w, 403, "Not your circuit")
				return
			}
			if err != nil {
				databaseFailure(w, err)
				return
			}
		}
		tag, err := tx.Exec(ctx, `INSERT INTO circuits(id,name,data,shape,author,owner,date) VALUES($1,$2,$3,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,author=excluded.author,date=excluded.date WHERE circuits.owner=excluded.owner`, key, body.Name, body.Data, me.Pseudo, user, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			databaseFailure(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			failure(w, 409, "Circuit already published")
			return
		}
		if body.Replaces != "" && body.Replaces != key {
			if _, err = tx.Exec(ctx, `INSERT INTO circuit_stars SELECT $1,account_id FROM circuit_stars WHERE circuit_id=$2 ON CONFLICT DO NOTHING`, key, body.Replaces); err != nil {
				databaseFailure(w, err)
				return
			}
			if _, err = tx.Exec(ctx, "DELETE FROM circuits WHERE id=$1 AND owner=$2", body.Replaces, user); err != nil {
				databaseFailure(w, err)
				return
			}
		}
		c, err := getCircuit(ctx, tx, key, user)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		if err = tx.Commit(ctx); err != nil {
			databaseFailure(w, err)
			return
		}
		success(w, c.view(me, true))
		return
	}
	if len(p) < 2 {
		failure(w, 405, "Method not allowed")
		return
	}
	c, err := getCircuit(ctx, a.db, p[1], user)
	if errors.Is(err, pgx.ErrNoRows) {
		failure(w, 404, "Circuit not found")
		return
	}
	if err != nil {
		databaseFailure(w, err)
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
		if c.Owner != user {
			failure(w, 403, "Not your circuit")
			return
		}
		if _, err = a.db.Exec(ctx, "DELETE FROM circuits WHERE id=$1 AND owner=$2", c.ID, user); err != nil {
			databaseFailure(w, err)
			return
		}
		success(w, map[string]bool{"deleted": true})
		return
	}
	if len(p) == 3 && p[2] == "star" && r.Method == "POST" {
		tx, e := a.db.Begin(ctx)
		if e != nil {
			databaseFailure(w, e)
			return
		}
		defer tx.Rollback(context.Background())
		var key string
		if e = tx.QueryRow(ctx, "SELECT id FROM circuits WHERE id=$1 FOR UPDATE", c.ID).Scan(&key); errors.Is(e, pgx.ErrNoRows) {
			failure(w, 404, "Circuit not found")
			return
		} else if e != nil {
			databaseFailure(w, e)
			return
		}
		tag, e := tx.Exec(ctx, "DELETE FROM circuit_stars WHERE circuit_id=$1 AND account_id=$2", key, user)
		if e == nil && tag.RowsAffected() == 0 {
			_, e = tx.Exec(ctx, "INSERT INTO circuit_stars VALUES($1,$2)", key, user)
		}
		if e != nil {
			databaseFailure(w, e)
			return
		}
		c, e = getCircuit(ctx, tx, key, user)
		if e != nil {
			databaseFailure(w, e)
			return
		}
		if e = tx.Commit(ctx); e != nil {
			databaseFailure(w, e)
			return
		}
		success(w, c.view(me, false))
		return
	}
	failure(w, 405, "Method not allowed")
}

const lapColumns = `account_id,name,time,car,color,ghost,date`

func scanLap(row pgx.Row) (Lap, error) {
	var lap Lap
	err := row.Scan(&lap.ID, &lap.Name, &lap.Time, &lap.Car, &lap.Color, &lap.Ghost, &lap.Date)
	return lap, err
}

func (a *App) tracks(w http.ResponseWriter, r *http.Request, p []string, me *Account) {
	ctx := r.Context()
	key, action := p[1], p[2]
	if len(key) > 128 {
		failure(w, 400, "Invalid track id")
		return
	}
	if action == "leaderboard" && r.Method == "GET" {
		rows, err := a.db.Query(ctx, `SELECT account_id,name,time,car,color,'null'::jsonb,date FROM lap_records WHERE track_key=$1 ORDER BY time,account_id LIMIT 500`, key)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		entries := []Lap{}
		var mine *Lap
		for rows.Next() {
			lap, e := scanLap(rows)
			if e != nil {
				rows.Close()
				databaseFailure(w, e)
				return
			}
			lap.Rank = len(entries) + 1
			lap.Ghost = nil
			entries = append(entries, lap)
			if me != nil && lap.ID == me.ID {
				v := lap
				mine = &v
			}
		}
		rows.Close()
		if rows.Err() != nil {
			databaseFailure(w, rows.Err())
			return
		}
		var total int
		if err = a.db.QueryRow(ctx, "SELECT count(*) FROM lap_records WHERE track_key=$1", key).Scan(&total); err != nil {
			databaseFailure(w, err)
			return
		}
		if me != nil && mine == nil {
			lap, e := scanLap(a.db.QueryRow(ctx, `SELECT account_id,name,time,car,color,'null'::jsonb,date FROM lap_records WHERE track_key=$1 AND account_id=$2`, key, me.ID))
			if e == nil {
				lap.Ghost = nil
				lap.Rank, err = a.rank(ctx, key, me.ID)
				if err != nil {
					databaseFailure(w, err)
					return
				}
				mine = &lap
			} else if !errors.Is(e, pgx.ErrNoRows) {
				databaseFailure(w, e)
				return
			}
		}
		success(w, map[string]any{"entries": entries, "total": total, "mine": mine})
		return
	}
	if action == "ghost" && r.Method == "GET" {
		lap, err := scanLap(a.db.QueryRow(ctx, `SELECT `+lapColumns+` FROM lap_records WHERE track_key=$1 ORDER BY time,account_id LIMIT 1`, key))
		if errors.Is(err, pgx.ErrNoRows) {
			failure(w, 404, "No record yet")
			return
		}
		if err != nil {
			databaseFailure(w, err)
			return
		}
		success(w, lap)
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
		if action == "archive" {
			success(w, map[string]bool{"archived": false})
			return
		}
		tag, err := a.db.Exec(ctx, `INSERT INTO lap_records(track_key,account_id,name,time,car,color,ghost,date) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(track_key,account_id) DO UPDATE SET name=excluded.name,time=excluded.time,car=excluded.car,color=excluded.color,ghost=excluded.ghost,date=excluded.date WHERE lap_records.time>excluded.time`, key, me.ID, me.Pseudo, lap.Time, lap.Car, lap.Color, lap.Ghost, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			databaseFailure(w, err)
			return
		}
		rank, err := a.rank(ctx, key, me.ID)
		if err != nil {
			databaseFailure(w, err)
			return
		}
		var total int
		if err := a.db.QueryRow(ctx, `SELECT count(*) FROM lap_records WHERE track_key=$1`, key).Scan(&total); err != nil {
			databaseFailure(w, err)
			return
		}
		improved := tag.RowsAffected() > 0
		success(w, map[string]any{"improved": improved, "rank": rank, "time": lap.Time, "record": improved && rank == 1, "leaderboard": map[string]int{"total": total}})
		return
	}
	failure(w, 405, "Method not allowed")
}

func (a *App) rank(ctx context.Context, key, user string) (int, error) {
	var rank int
	err := a.db.QueryRow(ctx, `SELECT count(*) FROM lap_records WHERE track_key=$1 AND (time,account_id)<=(SELECT time,account_id FROM lap_records WHERE track_key=$1 AND account_id=$2)`, key, user).Scan(&rank)
	return rank, err
}
