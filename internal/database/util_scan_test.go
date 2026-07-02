package database

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"database/sql"
	_ "modernc.org/sqlite"
)

// openTestDB seeds an on-disk SQLite DB to exercise scan against real driver.Rows.
func openTestDB(t *testing.T, rowCount int) *sql.DB {
	t.Helper()
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "scan.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		_ = os.RemoveAll(dir)
	})
	if _, err := db.Exec(`CREATE TABLE t (id INTEGER, label TEXT)`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO t VALUES (?, ?)`)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < rowCount; i++ {
		if _, err := stmt.Exec(i, "row-"+strconv.Itoa(i)); err != nil {
			t.Fatal(err)
		}
	}
	_ = stmt.Close()
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestScanRowsCtxBasic(t *testing.T) {
	db := openTestDB(t, 3)
	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	r, err := ScanRows(context.Background(), rows)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if r.RowCount != 3 {
		t.Fatalf("unexpected result: %+v", r)
	}
	if r.Columns[0] != "id" || r.Columns[1] != "label" {
		t.Fatalf("columns: %+v", r.Columns)
	}
}

// Cancelled ctx must abort mid-scan; guards against Stop being a no-op when driver buffers a large batch.
func TestScanRowsCtxHonoursCancellation(t *testing.T) {
	// 3000 rows ensures the ctx check (every 1024 rows) fires after cancel.
	db := openTestDB(t, 3000)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if _, err := ScanRows(ctx, rows); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestScanRowsCtxCancelsMidScan(t *testing.T) {
	db := openTestDB(t, 5000)
	ctx, cancel := context.WithCancel(context.Background())

	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	go func() { cancel() }()
	if _, err := ScanRows(ctx, rows); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("expected nil or context.Canceled, got %v", err)
	}
}

func TestScanRowsCtxReturnsEmptyColumnsForEmpty(t *testing.T) {
	db := openTestDB(t, 0)
	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t WHERE 1=0`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	r, err := ScanRows(context.Background(), rows)
	if err != nil {
		t.Fatal(err)
	}
	if r.RowCount != 0 || len(r.Rows) != 0 {
		t.Fatalf("expected 0 rows, got %+v", r)
	}
	if len(r.Columns) != 2 {
		t.Fatalf("columns should still be reported, got %+v", r.Columns)
	}
}

func TestScanRowsStreamDeliversBatches(t *testing.T) {
	const total = 2500
	db := openTestDB(t, total)
	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var metaCalls int
	var gotCols []string
	var batches [][][]any
	got, err := ScanRowsStream(context.Background(), rows, StreamOpts{
		BatchSize: 1000,
		OnMeta: func(cols, _ []string) {
			metaCalls++
			gotCols = cols
		},
		OnBatch: func(batch [][]any) error {
			batches = append(batches, batch)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if got != total {
		t.Fatalf("expected %d rows, got %d", total, got)
	}
	if metaCalls != 1 {
		t.Fatalf("OnMeta should fire exactly once, got %d", metaCalls)
	}
	if len(gotCols) != 2 || gotCols[0] != "id" {
		t.Fatalf("unexpected cols: %v", gotCols)
	}
	if len(batches) != 3 || len(batches[0]) != 1000 || len(batches[2]) != 500 {
		t.Fatalf("batch shape unexpected: lens=%d %d %d", len(batches[0]), len(batches[1]), len(batches[2]))
	}
}

func TestScanRowsStreamStopsOnCallbackError(t *testing.T) {
	db := openTestDB(t, 5000)
	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	want := errors.New("downstream is full")
	var calls int
	_, err = ScanRowsStream(context.Background(), rows, StreamOpts{
		BatchSize: 500,
		OnBatch: func([][]any) error {
			calls++
			return want
		},
	})
	if !errors.Is(err, want) {
		t.Fatalf("expected %v, got %v", want, err)
	}
	if calls != 1 {
		t.Fatalf("scan should stop after the first failing batch, got %d calls", calls)
	}
}

func TestScanRowsStreamHonoursContextCancel(t *testing.T) {
	db := openTestDB(t, 3000)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	rows, err := db.QueryContext(context.Background(), `SELECT id, label FROM t`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	if _, err := ScanRowsStream(ctx, rows, StreamOpts{BatchSize: 200}); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}
