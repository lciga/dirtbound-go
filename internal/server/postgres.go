package server

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// New opens PostgreSQL, applies the schema and imports a legacy JSON store
// transactionally once. PostgreSQL is the only live source of account data.
func New(files fs.FS, databaseURL, legacyPath string) (*App, error) {
	if databaseURL == "" && os.Getenv("PGHOST") == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL")
	}
	config.MaxConns = 12
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["statement_timeout"] = "5000"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, errors.New("cannot initialize PostgreSQL pool")
	}
	ok := false
	defer func() {
		if !ok {
			db.Close()
		}
	}()
	fail := func(err error) (*App, error) { return nil, err }
	if err = db.Ping(ctx); err != nil {
		return fail(errors.New("PostgreSQL is unavailable"))
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return fail(err)
	}
	defer tx.Rollback(context.Background())
	// Serializes startup/migration across application instances, not requests.
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(1700317001)"); err != nil {
		return fail(err)
	}
	if _, err = tx.Exec(ctx, schemaSQL); err != nil {
		return fail(fmt.Errorf("schema migration: %w", err))
	}
	if err = importLegacy(ctx, tx, legacyPath); err != nil {
		return fail(fmt.Errorf("legacy import: %w", err))
	}
	if seed, e := fs.ReadFile(files, "seed-circuits.json"); e == nil {
		var envelope struct {
			Data struct {
				Circuits []Circuit `json:"circuits"`
			} `json:"data"`
		}
		if e = json.Unmarshal(seed, &envelope); e != nil {
			return fail(fmt.Errorf("seed circuits: %w", e))
		}
		for _, c := range envelope.Data.Circuits {
			if _, err = tx.Exec(ctx, `INSERT INTO circuits(id,name,data,shape,author,owner,date) VALUES($1,$2,$3,$4,$5,NULL,$6) ON CONFLICT DO NOTHING`, c.ID, c.Name, c.Data, c.Shape, c.Author, c.Date); err != nil {
				return fail(err)
			}
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return fail(err)
	}
	a := &App{db: db, static: httpFiles(files), loginAttempts: map[string]*attempts{}, authSlots: make(chan struct{}, 4)}
	a.hub = newHub(a)
	ok = true
	return a, nil
}

func (a *App) Close() { a.db.Close() }

func importLegacy(ctx context.Context, tx pgx.Tx, path string) error {
	if path == "" {
		return nil
	}
	var done bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM data_imports WHERE name='legacy-json-v1')").Scan(&done); err != nil || done {
		return err
	}
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var occupied bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM accounts) OR EXISTS(SELECT 1 FROM lap_records) OR EXISTS(SELECT 1 FROM circuits WHERE owner IS NOT NULL)`).Scan(&occupied); err != nil {
		return err
	}
	if occupied {
		return errors.New("database already contains player data; refusing to merge an unimported JSON store")
	}
	var store Store
	if err = json.Unmarshal(raw, &store); err != nil {
		return err
	}
	for _, a := range store.Accounts {
		if _, err = tx.Exec(ctx, `INSERT INTO accounts(id,username,pseudo) VALUES($1,$2,$3)`, a.ID, a.Username, a.Pseudo); err != nil {
			return err
		}
	}
	for login, c := range store.Credentials {
		if c.Iterations < 1 || c.Iterations > 2000000 || len(c.Salt) != 32 || len(c.Hash) != 64 {
			return errors.New("invalid legacy password hash")
		}
		if _, err = tx.Exec(ctx, `INSERT INTO credentials(login,account_id,salt,hash,iterations) VALUES($1,$2,$3,$4,$5)`, login, c.Account, c.Salt, c.Hash, c.Iterations); err != nil {
			return err
		}
	}
	for hash, s := range store.Sessions {
		if _, err = tx.Exec(ctx, `INSERT INTO sessions(token_hash,account_id,expires) VALUES($1,$2,$3)`, hash, s.Account, s.Expires); err != nil {
			return err
		}
	}
	for _, c := range store.Circuits {
		if _, err = tx.Exec(ctx, `INSERT INTO circuits(id,name,data,shape,author,owner,date) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7)`, c.ID, c.Name, c.Data, c.Shape, c.Author, c.Owner, c.Date); err != nil {
			return err
		}
		for account, starred := range c.Stars {
			if starred {
				if _, err = tx.Exec(ctx, `INSERT INTO circuit_stars VALUES($1,$2)`, c.ID, account); err != nil {
					return err
				}
			}
		}
	}
	for key, laps := range store.Laps {
		for _, lap := range laps {
			if _, err = tx.Exec(ctx, `INSERT INTO lap_records(track_key,account_id,name,time,car,color,ghost,date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, key, lap.ID, lap.Name, lap.Time, lap.Car, lap.Color, lap.Ghost, lap.Date); err != nil {
				return err
			}
		}
	}
	sum := sha256.Sum256(raw)
	_, err = tx.Exec(ctx, `INSERT INTO data_imports(name,source_sha256) VALUES('legacy-json-v1',$1)`, hex.EncodeToString(sum[:]))
	return err
}

func (a *App) account(r *http.Request) (*Account, error) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	cookie, err := r.Cookie("dirtbound-session")
	if err != nil {
		return nil, nil
	}
	var account Account
	err = a.db.QueryRow(ctx, `SELECT a.id,a.username,a.pseudo FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires>$2`, sessionKey(cookie.Value), time.Now().Unix()).Scan(&account.ID, &account.Username, &account.Pseudo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &account, nil
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

const circuitColumns = `c.id,c.name,c.data,c.shape,c.author,COALESCE(c.owner,''),c.date,
 (SELECT count(*) FROM circuit_stars s WHERE s.circuit_id=c.id),
 EXISTS(SELECT 1 FROM circuit_stars s WHERE s.circuit_id=c.id AND s.account_id=$1)`

// Catalogue responses do not read/decompress the full terrain from PostgreSQL.
var circuitSummaryColumns = strings.Replace(circuitColumns, "c.data", "''", 1)

func scanCircuit(row pgx.Row, me string) (*Circuit, error) {
	var c Circuit
	var starred bool
	if err := row.Scan(&c.ID, &c.Name, &c.Data, &c.Shape, &c.Author, &c.Owner, &c.Date, &c.starCount, &starred); err != nil {
		return nil, err
	}
	c.Stars = map[string]bool{}
	if starred {
		c.Stars[me] = true
	}
	return &c, nil
}
func accountID(me *Account) string {
	if me != nil {
		return me.ID
	}
	return ""
}

func getCircuit(ctx context.Context, db queryer, key, me string) (*Circuit, error) {
	return scanCircuit(db.QueryRow(ctx, `SELECT `+circuitColumns+` FROM circuits c WHERE c.id=$2`, me, key), me)
}
