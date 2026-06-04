package postgres

import (
	"fmt"
	"net/url"

	"xensql/internal/database"
)

// Empty password must be omitted entirely - libpq treats `password=` as a value and drops dbname.
func buildDSN(cfg database.ConnectionConfig) string {
	port := cfg.Port
	if port == 0 {
		port = 5432
	}
	ssl := cfg.SSLMode
	if ssl == "" {
		ssl = "disable"
	}

	user := url.UserPassword(cfg.Username, cfg.Password)
	if cfg.Password == "" {
		user = url.User(cfg.Username)
	}

	u := &url.URL{
		Scheme: "postgres",
		User:   user,
		Host:   fmt.Sprintf("%s:%d", cfg.Host, port),
		Path:   "/" + cfg.Database,
	}
	q := u.Query()
	q.Set("sslmode", ssl)
	q.Set("connect_timeout", "10") // seconds - fail fast on an unreachable host
	u.RawQuery = q.Encode()
	return u.String()
}
