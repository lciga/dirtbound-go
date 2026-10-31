package server

import (
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
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

// authenticate is called while the store mutex is held. Authentication is kept
// separate from the race hub; expensive password work never holds the hub lock.
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
	for key, v := range a.loginAttempts {
		if now.Sub(v.Start) > 5*time.Minute {
			delete(a.loginAttempts, key)
		}
	}
	bucket := a.loginAttempts[ip]
	if bucket == nil {
		bucket = &attempts{Start: now}
		a.loginAttempts[ip] = bucket
	}
	bucket.Count++
	if bucket.Count > 10 {
		w.Header().Set("Retry-After", "300")
		failure(w, 429, "Слишком много попыток. Повторите через 5 минут.")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Next     string `json:"next"`
	}
	if !decode(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	if !usernamePattern.MatchString(body.Username) || len(body.Password) < 8 || len(body.Password) > 128 {
		failure(w, 400, "Логин: 3–20 букв, цифр, точек, дефисов или подчёркиваний. Пароль: 8–128 байт.")
		return
	}
	login := strings.ToLower(body.Username)
	var account *Account
	if action == "auth/register" {
		if _, exists := a.store.Credentials[login]; exists {
			failure(w, 409, "Этот логин уже занят.")
			return
		}
		salt := id(16)
		key := passwordKey(body.Password, salt, passwordIterations)
		accountID := id(3)
		for a.store.Accounts[accountID] != nil {
			accountID = id(3)
		}
		account = &Account{ID: accountID, Username: body.Username, Pseudo: body.Username}
		a.store.Accounts[account.ID] = account
		a.store.Credentials[login] = Credential{Account: account.ID, Salt: salt, Hash: hex.EncodeToString(key), Iterations: passwordIterations}
	} else {
		cred, exists := a.store.Credentials[login]
		if !exists {
			cred = Credential{Salt: strings.Repeat("0", 32), Hash: strings.Repeat("0", 64), Iterations: passwordIterations}
		}
		expected, _ := hex.DecodeString(cred.Hash)
		actual := passwordKey(body.Password, cred.Salt, cred.Iterations)
		if subtle.ConstantTimeCompare(actual, expected) != 1 || !exists {
			failure(w, 401, "Неверный логин или пароль.")
			return
		}
		account = a.store.Accounts[cred.Account]
		if account == nil {
			failure(w, 401, "Неверный логин или пароль.")
			return
		}
	}
	token := id(32)
	for key, v := range a.store.Sessions {
		if v.Expires < now.Unix() {
			delete(a.store.Sessions, key)
		}
	}
	// Rotate the current browser's session without logging out other devices.
	if old, e := r.Cookie("dirtbound-session"); e == nil {
		delete(a.store.Sessions, sessionKey(old.Value))
	}
	a.store.Sessions[sessionKey(token)] = Session{Account: account.ID, Expires: now.Add(sessionLifetime).Unix()}
	if a.saveLocked() != nil {
		failure(w, 500, "Не удалось сохранить профиль.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "dirtbound-session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", MaxAge: int(sessionLifetime.Seconds())})
	next := "/index.html"
	if u, e := url.Parse(body.Next); e == nil && u.Host == "" && u.Scheme == "" && strings.HasPrefix(u.Path, "/") && !strings.HasPrefix(u.Path, "//") {
		next = u.RequestURI()
		if u.Fragment != "" {
			next += "#" + u.EscapedFragment()
		}
	}
	success(w, map[string]any{"account": account, "url": next})
}
