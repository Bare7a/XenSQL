package database

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	sqlite "modernc.org/sqlite"
)

func TestClassifyErrorNil(t *testing.T) {
	if got := ClassifyError(nil); got != nil {
		t.Fatalf("ClassifyError(nil) = %+v, want nil", got)
	}
}

func TestClassifyErrorCancelled(t *testing.T) {
	// A wrapped context.Canceled must still be flagged.
	wrapped := fmt.Errorf("query cancelled: %w", context.Canceled)
	got := ClassifyError(wrapped)
	if got == nil || !got.Cancelled {
		t.Fatalf("ClassifyError(cancelled) = %+v, want Cancelled=true", got)
	}
	if got := ClassifyError(context.DeadlineExceeded); got == nil || !got.Cancelled {
		t.Fatalf("ClassifyError(deadline) = %+v, want Cancelled=true", got)
	}
}

func TestClassifyErrorPostgres(t *testing.T) {
	pgErr := &pgconn.PgError{
		Severity: "ERROR",
		Code:     "42P01",
		Message:  `relation "nope" does not exist`,
		Hint:     "check the table name",
		Detail:   "some detail",
		Position: 15,
	}
	got := ClassifyError(fmt.Errorf("exec: %w", pgErr))
	if got == nil {
		t.Fatal("ClassifyError(pg) = nil")
	}
	if got.Code != "42P01" || got.Hint != "check the table name" || got.Detail != "some detail" || got.Position != 15 {
		t.Fatalf("pg fields not extracted: %+v", got)
	}
	if got.Message != `relation "nope" does not exist` {
		t.Fatalf("pg message = %q", got.Message)
	}
	if got.Cancelled {
		t.Fatal("pg error must not be flagged cancelled")
	}
}

func TestClassifyErrorMySQL(t *testing.T) {
	myErr := &mysql.MySQLError{Number: 1146, Message: "Table 'x.y' doesn't exist"}
	got := ClassifyError(myErr)
	if got == nil || got.Code != "1146" {
		t.Fatalf("mysql code not extracted: %+v", got)
	}
	if got.Message != "Table 'x.y' doesn't exist" {
		t.Fatalf("mysql message = %q", got.Message)
	}
}

func TestClassifyErrorSQLite(t *testing.T) {
	liteErr := &sqlite.Error{}
	// sqlite.Error fields are unexported; just verify the code round-trips.
	got := ClassifyError(liteErr)
	if got == nil {
		t.Fatal("ClassifyError(sqlite) = nil")
	}
	if got.Code != fmt.Sprintf("%d", liteErr.Code()) {
		t.Fatalf("sqlite code = %q, want %q", got.Code, fmt.Sprintf("%d", liteErr.Code()))
	}
}

func TestClassifyErrorGeneric(t *testing.T) {
	got := ClassifyError(errors.New("boom"))
	if got == nil || got.Message != "boom" || got.Code != "" || got.Cancelled {
		t.Fatalf("generic classify = %+v", got)
	}
}
