package server

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

func TestLegacyMigrationKeepsCredentialsSessionsRecordsAndDoesNotReimport(t *testing.T) {
	a := newTestApp(t, fstest.MapFS{})
	ctx := context.Background()
	salt := "0123456789abcdef0123456789abcdef"
	token := "old-private-session"
	password := "Existing-password-123"
	ghost := json.RawMessage(`{"v":1,"rate":20,"data":[]}`)
	store := Store{Accounts: map[string]*Account{"abc123": {ID: "abc123", Username: "old_driver", Pseudo: "Old Driver"}}, Credentials: map[string]Credential{"old_driver": {Account: "abc123", Salt: salt, Hash: hex.EncodeToString(passwordKey(password, salt, passwordIterations)), Iterations: passwordIterations}}, Sessions: map[string]Session{sessionKey(token): {Account: "abc123", Expires: time.Now().Add(time.Hour).Unix()}}, Circuits: map[string]*Circuit{"track": {ID: "track", Name: "Legacy track", Data: "encoded", Shape: "shape", Owner: "abc123", Author: "Old Driver", Date: "2026-01-01T00:00:00Z", Stars: map[string]bool{"abc123": true}}}, Laps: map[string][]Lap{"track": {{ID: "abc123", Name: "Old Driver", Time: 12.3, Car: "truck", Color: 1, Ghost: ghost, Date: "2026-01-02T00:00:00Z"}}}}
	raw, _ := json.Marshal(store)
	legacy := filepath.Join(t.TempDir(), "store.json")
	if err := os.WriteFile(legacy, raw, 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := New(fstest.MapFS{}, a.db.Config().ConnConfig.ConnString(), legacy)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	req := httptest.NewRequest("GET", "/api/me/dashboard", nil)
	req.AddCookie(&http.Cookie{Name: "dirtbound-session", Value: token})
	w := httptest.NewRecorder()
	restored.ServeHTTP(w, req)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"circuits":1`) || !strings.Contains(w.Body.String(), `"records":1`) || !strings.Contains(w.Body.String(), `"stars":1`) {
		t.Fatal("legacy profile", w.Code, w.Body.String())
	}
	server := httptest.NewServer(restored)
	defer server.Close()
	logged := call(t, server.Client(), "POST", server.URL+"/api/auth/login", map[string]string{"username": "old_driver", "password": password})
	if logged["success"] != true {
		t.Fatal("legacy password", logged)
	}
	if _, err = a.db.Exec(ctx, `UPDATE accounts SET pseudo='Changed after import' WHERE id='abc123'`); err != nil {
		t.Fatal(err)
	}
	again, err := New(fstest.MapFS{}, a.db.Config().ConnConfig.ConnString(), legacy)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	var name string
	again.db.QueryRow(ctx, "SELECT pseudo FROM accounts WHERE id='abc123'").Scan(&name)
	if name != "Changed after import" {
		t.Fatal("reimport overwrote database")
	}
	original, _ := os.ReadFile(legacy)
	if !bytes.Equal(original, raw) {
		t.Fatal("legacy backup was modified")
	}
	var count int
	again.db.QueryRow(ctx, "SELECT count(*) FROM data_imports").Scan(&count)
	if count != 1 {
		t.Fatal("import marker", count)
	}
}
func TestLegacyImportRollsBackEntireTransactionOnBrokenOwnership(t *testing.T) {
	a := newTestApp(t, fstest.MapFS{})
	legacy := filepath.Join(t.TempDir(), "store.json")
	os.WriteFile(legacy, []byte(`{"accounts":{"abc123":{"id":"abc123","pseudo":"Driver"}},"circuits":{"bad":{"id":"bad","owner":"missing","name":"Bad","data":"bad","shape":"bad"}}}`), 0600)
	app, err := New(fstest.MapFS{}, a.db.Config().ConnConfig.ConnString(), legacy)
	if app != nil {
		app.Close()
	}
	if err == nil {
		t.Fatal("broken foreign key accepted")
	}
	var count int
	a.db.QueryRow(context.Background(), "SELECT count(*) FROM accounts").Scan(&count)
	if count != 0 {
		t.Fatal("partial import committed")
	}
	a.db.QueryRow(context.Background(), "SELECT count(*) FROM data_imports").Scan(&count)
	if count != 0 {
		t.Fatal("failed import marked complete")
	}
}
func TestConcurrentLapsKeepFastestAndDashboardIsScoped(t *testing.T) {
	_, s, c := newTest(t)
	login(t, c, s.URL, "Concurrent Driver")
	var wg sync.WaitGroup
	failures := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			seconds := float64(i + 1)
			ghost := map[string]any{"v": 1, "rate": 20, "data": make([]int, (20*(i+1)+1)*8)}
			raw, _ := json.Marshal(map[string]any{"time": seconds, "car": "Audi Quattro S1", "color": 1, "ghost": ghost})
			r, err := c.Post(s.URL+"/api/tracks/default/laps", "application/json", bytes.NewReader(raw))
			if err != nil {
				failures <- err.Error()
				return
			}
			defer r.Body.Close()
			if r.StatusCode != 200 {
				failures <- r.Status
			}
		}(i)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	r := call(t, c, "GET", s.URL+"/api/tracks/default/leaderboard", nil)
	entry := r["data"].(map[string]any)["entries"].([]any)[0].(map[string]any)
	if entry["time"] != float64(1) {
		t.Fatal("lost best result", entry)
	}
	dashboard := call(t, c, "GET", s.URL+"/api/me/dashboard", nil)
	data := dashboard["data"].(map[string]any)
	if data["stats"].(map[string]any)["records"] != float64(1) || data["results"].([]any)[0].(map[string]any)["rank"] != float64(1) {
		t.Fatal(dashboard)
	}
	raw, _ := json.Marshal(dashboard)
	if bytes.Contains(raw, []byte("ghost")) || bytes.Contains(raw, []byte("hash")) {
		t.Fatal("private/large fields in dashboard")
	}
	guest := call(t, s.Client(), "GET", s.URL+"/api/me/dashboard", nil)
	if guest["success"] != false {
		t.Fatal("guest dashboard")
	}
}
func TestCataloguePaginationAndMine(t *testing.T) {
	_, s, c := newTest(t)
	login(t, c, s.URL, "Owner Driver")
	for _, data := range []string{"first-encoded-track", "second-encoded-track", "third-encoded-track"} {
		r := call(t, c, "POST", s.URL+"/api/circuits", map[string]string{"name": "Track", "data": data})
		if r["success"] != true {
			t.Fatal(r)
		}
	}
	result := call(t, c, "GET", s.URL+"/api/circuits?mine=1&limit=2&page=2", nil)["data"].(map[string]any)
	if result["total"] != float64(3) || len(result["circuits"].([]any)) != 1 {
		t.Fatal(result)
	}
	if _, exists := result["circuits"].([]any)[0].(map[string]any)["data"]; exists {
		t.Fatal("terrain in summary")
	}
	if call(t, s.Client(), "GET", s.URL+"/api/circuits?mine=1", nil)["success"] != false {
		t.Fatal("guest mine filter")
	}
}
