package server

import (
	"context"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const passwordIterations = 600000
const sessionLifetime = 30 * 24 * time.Hour

var usernamePattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}_.-]{2,19}$`)

type Credential struct {
	Account    string `json:"account"`
	Salt       string `json:"salt"`
	Hash       string `json:"hash"`
	Iterations int    `json:"iterations"`
}
type Session struct {
	Account string `json:"account"`
	Expires int64  `json:"expires"`
}
type attempts struct {
	Start time.Time
	Count int
}

func sessionKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func passwordKey(password, salt string, iterations int) []byte {
	raw, _ := hex.DecodeString(salt)
	key, err := pbkdf2.Key(sha256.New, password, raw, iterations, 32)
	if err != nil {
		panic(err)
	}
	return key
}

func (a *App) allowLogin(ip string, now time.Time) bool {
	a.authMu.Lock()
	defer a.authMu.Unlock()
	for key, v := range a.loginAttempts {
		if now.Sub(v.Start) > 5*time.Minute {
			delete(a.loginAttempts, key)
		}
	}
	bucket := a.loginAttempts[ip]
	if bucket == nil {
		if len(a.loginAttempts) >= 4096 {
			return false
		}
		bucket = &attempts{Start: now}
		a.loginAttempts[ip] = bucket
	}
	bucket.Count++
	return bucket.Count <= 10
}

func (a *App) authenticate(w http.ResponseWriter, r *http.Request, action string) {
	if r.Method != "POST" {
		failure(w, 405, "POST required")
		return
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	now := time.Now()
	if !a.allowLogin(ip, now) {
		w.Header().Set("Retry-After", "300")
		failure(w, 429, "Слишком много попыток. Повторите через 5 минут.")
		return
	}
	select {
	case a.authSlots <- struct{}{}:
		defer func() { <-a.authSlots }()
	default:
		w.Header().Set("Retry-After", "1")
		failure(w, 429, "Сервер занят. Повторите через секунду.")
		return
	}
	var body struct{ Username, Password, Next string }
	if !decode(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !usernamePattern.MatchString(body.Username) || len(body.Password) < 8 || len(body.Password) > 128 {
		failure(w, 400, "Логин: 3–20 букв, цифр, точек, дефисов или подчёркиваний. Пароль: 8–128 байт.")
		return
	}
	login := strings.ToLower(body.Username)
	ctx := r.Context()
	account := Account{}
	var cred Credential
	registering := action == "auth/register"
	if registering {
		cred = Credential{Salt: id(16), Iterations: passwordIterations}
		cred.Hash = hex.EncodeToString(passwordKey(body.Password, cred.Salt, cred.Iterations))
		account = Account{ID: id(12), Username: body.Username, Pseudo: body.Username}
		cred.Account = account.ID
	} else {
		err = a.db.QueryRow(ctx, `SELECT c.account_id,c.salt,c.hash,c.iterations,a.id,a.username,a.pseudo FROM credentials c JOIN accounts a ON a.id=c.account_id WHERE c.login=$1`, login).Scan(&cred.Account, &cred.Salt, &cred.Hash, &cred.Iterations, &account.ID, &account.Username, &account.Pseudo)
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			databaseFailure(w, err)
			return
		}
		if !exists {
			cred = Credential{Salt: strings.Repeat("0", 32), Hash: strings.Repeat("0", 64), Iterations: passwordIterations}
		}
		expected, _ := hex.DecodeString(cred.Hash)
		actual := passwordKey(body.Password, cred.Salt, cred.Iterations)
		if subtle.ConstantTimeCompare(actual, expected) != 1 || !exists {
			failure(w, 401, "Неверный логин или пароль.")
			return
		}
	}
	tx, err := a.db.Begin(ctx)
	if err != nil {
		databaseFailure(w, err)
		return
	}
	defer tx.Rollback(context.Background())
	if registering {
		_, err = tx.Exec(ctx, `INSERT INTO accounts(id,username,pseudo) VALUES($1,$2,$3)`, account.ID, account.Username, account.Pseudo)
		if err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO credentials(login,account_id,salt,hash,iterations) VALUES($1,$2,$3,$4,$5)`, login, account.ID, cred.Salt, cred.Hash, cred.Iterations)
		}
		if err != nil {
			var pgerr *pgconn.PgError
			if errors.As(err, &pgerr) && pgerr.Code == "23505" {
				failure(w, 409, "Этот логин уже занят.")
			} else {
				databaseFailure(w, err)
			}
			return
		}
	}
	// Expensive hashing above never blocks unrelated profiles or game requests.
	token := id(32)
	if old, e := r.Cookie("dirtbound-session"); e == nil {
		_, err = tx.Exec(ctx, "DELETE FROM sessions WHERE token_hash=$1", sessionKey(old.Value))
		if err != nil {
			databaseFailure(w, err)
			return
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires<$1 LIMIT 1000)`, now.Unix()); err != nil {
		databaseFailure(w, err)
		return
	}
	if _, err = tx.Exec(ctx, `INSERT INTO sessions(token_hash,account_id,expires) VALUES($1,$2,$3)`, sessionKey(token), account.ID, now.Add(sessionLifetime).Unix()); err != nil {
		databaseFailure(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		databaseFailure(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "dirtbound-session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", MaxAge: int(sessionLifetime.Seconds())})
	next := "/menu.html"
	if u, e := url.Parse(body.Next); e == nil && u.Host == "" && u.Scheme == "" && strings.HasPrefix(u.Path, "/") && !strings.HasPrefix(u.Path, "//") {
		next = u.RequestURI()
		if u.Fragment != "" {
			next += "#" + u.EscapedFragment()
		}
	}
	success(w, map[string]any{"account": account, "url": next})
}
