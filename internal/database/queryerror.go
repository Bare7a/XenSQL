package database

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	sqlite "modernc.org/sqlite"
)

// QueryError is the structured, driver-agnostic form of a failed query sent to the frontend.
type QueryError struct {
	Message   string `json:"message"`
	Code      string `json:"code,omitempty"` // SQLSTATE (postgres), error number (mysql), or result code (sqlite)
	Detail    string `json:"detail,omitempty"`
	Hint      string `json:"hint,omitempty"`
	Position  int    `json:"position,omitempty"` // 1-based char offset into the failing statement (postgres)
	Severity  string `json:"severity,omitempty"`
	Cancelled bool   `json:"cancelled,omitempty"`
}

// ClassifyError converts a driver error into a structured QueryError; cancellations are flagged, not
// reported as failures. Returns nil for a nil error.
func ClassifyError(err error) *QueryError {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return &QueryError{Message: err.Error(), Cancelled: true}
	}

	qe := &QueryError{Message: err.Error()}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Message != "" {
			qe.Message = pgErr.Message
		}
		qe.Code = pgErr.Code
		qe.Detail = pgErr.Detail
		qe.Hint = pgErr.Hint
		qe.Position = int(pgErr.Position)
		qe.Severity = pgErr.Severity
		return qe
	}

	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		if myErr.Message != "" {
			qe.Message = myErr.Message
		}
		qe.Code = mysqlErrorCode(myErr)
		return qe
	}

	var liteErr *sqlite.Error
	if errors.As(err, &liteErr) {
		qe.Code = fmt.Sprintf("%d", liteErr.Code())
		return qe
	}

	return qe
}

// mysqlErrorCode prefers the numeric error number (e.g. 1146), falling back to SQLSTATE.
func mysqlErrorCode(e *mysql.MySQLError) string {
	if e.Number != 0 {
		return fmt.Sprintf("%d", e.Number)
	}
	return strings.Trim(string(e.SQLState[:]), "\x00 ")
}
