package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"
	"time"
)

func (a *App) redeemBeta(w http.ResponseWriter, r *http.Request, me *Account) {
	if r.Method != "POST" {
		failure(w, 405, "POST required")
		return
	}
	if me == nil {
		failure(w, 401, "Сначала войдите в аккаунт.")
		return
	}
	if me.Beta {
		success(w, me)
		return
	}
	if !a.allowLogin("beta:"+me.ID, time.Now()) {
		failure(w, 429, "Слишком много попыток. Повторите через 5 минут.")
		return
	}
	var body struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &body) {
		return
	}
	sum := sha256.Sum256([]byte(strings.TrimSpace(body.Code)))
	if !a.betaEnabled || subtle.ConstantTimeCompare(sum[:], a.betaCodeHash[:]) != 1 {
		failure(w, 403, "Неверный код бетатестера.")
		return
	}
	if _, err := a.db.Exec(r.Context(), "UPDATE accounts SET beta_access=true WHERE id=$1", me.ID); err != nil {
		databaseFailure(w, err)
		return
	}
	me.Beta = true
	a.hub.mu.Lock()
	if peer := a.hub.peers[me.ID]; peer != nil {
		peer.beta = true
	}
	a.hub.mu.Unlock()
	success(w, me)
}
