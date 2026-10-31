package server

import "net/http"

func (a *App) dashboard(w http.ResponseWriter, r *http.Request, me *Account) {
	if r.Method != "GET" {
		failure(w, 405, "GET required")
		return
	}
	if me == nil {
		failure(w, 401, "Sign in first")
		return
	}
	ctx := r.Context()
	var circuits, records, stars int
	err := a.db.QueryRow(ctx, `SELECT (SELECT count(*) FROM circuits WHERE owner=$1),(SELECT count(*) FROM lap_records WHERE account_id=$1),(SELECT count(*) FROM circuit_stars s JOIN circuits c ON c.id=s.circuit_id WHERE c.owner=$1)`, me.ID).Scan(&circuits, &records, &stars)
	if err != nil {
		databaseFailure(w, err)
		return
	}
	rows, err := a.db.Query(ctx, `SELECT l.track_key,COALESCE(c.name,CASE WHEN l.track_key='default' THEN 'Базовая трасса' ELSE 'Заезд' END),l.time,l.car,l.color,l.date,COALESCE(c.id,''),
  (SELECT count(*) FROM lap_records ranked WHERE ranked.track_key=l.track_key AND (ranked.time,ranked.account_id)<=(l.time,l.account_id))
  FROM lap_records l LEFT JOIN circuits c ON c.id=l.track_key WHERE l.account_id=$1 ORDER BY l.date DESC LIMIT 50`, me.ID)
	if err != nil {
		databaseFailure(w, err)
		return
	}
	defer rows.Close()
	results := []map[string]any{}
	for rows.Next() {
		var key, name, car, date, circuit string
		var seconds float64
		var color, rank int
		if err = rows.Scan(&key, &name, &seconds, &car, &color, &date, &circuit, &rank); err != nil {
			databaseFailure(w, err)
			return
		}
		results = append(results, map[string]any{"track": key, "name": name, "time": seconds, "car": car, "color": color, "date": date, "circuit": circuit, "rank": rank})
	}
	if rows.Err() != nil {
		databaseFailure(w, rows.Err())
		return
	}
	success(w, map[string]any{"account": me, "stats": map[string]int{"circuits": circuits, "records": records, "stars": stars}, "results": results})
}
