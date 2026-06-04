package mysql

import (
	"crypto/tls"
	"fmt"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"

	"xensql/internal/database"
)

func buildConfig(cfg database.ConnectionConfig) *mysqldriver.Config {
	port := cfg.Port
	if port == 0 {
		port = 3306
	}
	mysqlCfg := mysqldriver.NewConfig()
	mysqlCfg.User = cfg.Username
	mysqlCfg.Passwd = cfg.Password
	mysqlCfg.Net = "tcp"
	mysqlCfg.Addr = fmt.Sprintf("%s:%d", cfg.Host, port)
	mysqlCfg.DBName = cfg.Database
	mysqlCfg.ParseTime = true
	mysqlCfg.AllowNativePasswords = true
	mysqlCfg.Timeout = 10 * time.Second // dial timeout only (not query execution)

	switch cfg.SSLMode {
	case "require":
		mysqlCfg.TLS = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // user-selected: encrypt without verification
	case "verify-full":
		mysqlCfg.TLS = &tls.Config{ServerName: cfg.Host} // verify the server cert against the hostname
	default:
		mysqlCfg.TLS = nil
	}
	return mysqlCfg
}

// Retained for tests; the live path uses buildConfig + NewConnector because FormatDSN() drops the in-memory TLS config.
func buildDSN(cfg database.ConnectionConfig) (string, error) {
	return buildConfig(cfg).FormatDSN(), nil
}
