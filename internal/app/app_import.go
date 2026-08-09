package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"xensql/internal/database"
	"xensql/internal/service"
)

const previewRowLimit = 100

// maxReportedErrors truncates the messages only; the skipped count stays exact.
const maxReportedErrors = 20

const defaultImportBatchSize = 500

// Above this the row count is skipped; bytes drive the bar.
const maxRowCountBytes = 64 << 20

const progressInterval = 100 * time.Millisecond

type ImportPreview struct {
	Columns []string   `json:"columns"`
	Rows    [][]string `json:"rows"`
	// InferredTypes are driver-neutral shapes; SQLTypes are the same in the connection's dialect.
	InferredTypes []string `json:"inferredTypes"`
	SQLTypes      []string `json:"sqlTypes"`
	// Delimiter is what was actually used, so a sniffed one shows in the dialog.
	Delimiter  string `json:"delimiter"`
	TotalBytes int64  `json:"totalBytes"`
	Truncated  bool   `json:"truncated"`
	// 0 when the file was too large to count.
	TotalRows int64 `json:"totalRows"`
}

type CSVImportRequest struct {
	Path        string             `json:"path"`
	Schema      string             `json:"schema"`
	Table       string             `json:"table"`
	CreateTable bool               `json:"createTable"`
	Truncate    bool               `json:"truncate"`
	Options     service.CSVOptions `json:"options"`
	// Mapping is parallel to the file's columns: the target column, or empty to skip it.
	Mapping []string `json:"mapping"`
	// ColumnTypes is parallel to Mapping; it drives CREATE TABLE and boolean normalization.
	ColumnTypes []string `json:"columnTypes"`
	BatchSize   int      `json:"batchSize"`
	// StopOnError aborts at the first bad row instead of skipping it.
	StopOnError bool `json:"stopOnError"`
}

type SQLImportRequest struct {
	Path        string `json:"path"`
	StopOnError bool   `json:"stopOnError"`
}

// ImportResult summarizes a run. Batches autocommit, so a failed run keeps what it loaded.
type ImportResult struct {
	Inserted   int64    `json:"inserted"`
	Skipped    int64    `json:"skipped"`
	Statements int64    `json:"statements"`
	DurationMs int64    `json:"durationMs"`
	Errors     []string `json:"errors,omitempty"`
	Cancelled  bool     `json:"cancelled"`
}

type ImportProgressEvent struct {
	Seq        int    `json:"seq"`
	ImportID   string `json:"importId"`
	Processed  int64  `json:"processed"`
	Inserted   int64  `json:"inserted"`
	Skipped    int64  `json:"skipped"`
	BytesRead  int64  `json:"bytesRead"`
	TotalBytes int64  `json:"totalBytes"`
	// 0 when unknown; BytesRead then drives the bar.
	TotalRows int64 `json:"totalRows"`
}

type ImportDoneEvent struct {
	Seq      int           `json:"seq"`
	ImportID string        `json:"importId"`
	Result   *ImportResult `json:"result,omitempty"`
	Error    string        `json:"error,omitempty"`
}

type countingReader struct {
	r io.Reader
	n atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}

func (a *App) PickImportFile(kind string) (string, error) {
	dialog := a.app.Dialog.OpenFile().SetTitle("Select file to import").CanChooseFiles(true)
	if strings.EqualFold(kind, "sql") {
		dialog = dialog.AddFilter("SQL script", "*.sql")
	} else {
		dialog = dialog.AddFilter("Delimited text", "*.csv;*.tsv;*.txt")
	}
	return dialog.AddFilter("All Files", "*.*").PromptForSingleSelection()
}

func (a *App) PreviewImportFile(connectionID, path string, opts service.CSVOptions) (ImportPreview, error) {
	if path == "" {
		return ImportPreview{}, fmt.Errorf("no file selected")
	}
	cfg, err := a.getConnection(connectionID)
	if err != nil {
		return ImportPreview{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return ImportPreview{}, err
	}
	defer file.Close()

	var totalBytes int64
	if info, statErr := file.Stat(); statErr == nil {
		totalBytes = info.Size()
	}
	// Before the sample, which consumes the reader.
	totalRows := countCSVRows(file, opts, totalBytes)
	reader, err := service.NewCSVReader(file, opts)
	if err != nil {
		return ImportPreview{}, err
	}

	columns, rows, truncated, err := readSample(reader, opts.HasHeader, previewRowLimit)
	if err != nil {
		return ImportPreview{}, err
	}
	if len(columns) == 0 {
		return ImportPreview{}, fmt.Errorf("the file has no columns")
	}

	inferred := make([]string, len(columns))
	sqlTypes := make([]string, len(columns))
	for i := range columns {
		samples := make([]string, 0, len(rows))
		for _, row := range rows {
			if i < len(row) {
				samples = append(samples, row[i])
			}
		}
		t := service.InferColumnType(samples)
		inferred[i] = string(t)
		sqlTypes[i] = database.SQLTypeFor(cfg.Driver, database.ImportColumnType(t))
	}

	return ImportPreview{
		Columns:       columns,
		Rows:          rows,
		InferredTypes: inferred,
		SQLTypes:      sqlTypes,
		Delimiter:     string(reader.Comma()),
		TotalBytes:    totalBytes,
		Truncated:     truncated,
		TotalRows:     totalRows,
	}, nil
}

// countCSVRows counts with the import's own reader settings; 0 when too big to scan twice.
func countCSVRows(file *os.File, opts service.CSVOptions, totalBytes int64) int64 {
	defer func() { _, _ = file.Seek(0, io.SeekStart) }()
	if totalBytes > maxRowCountBytes {
		return 0
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return 0
	}
	reader, err := service.NewCSVReader(file, opts)
	if err != nil {
		return 0
	}
	if opts.HasHeader {
		if _, hErr := reader.Read(); hErr != nil {
			return 0
		}
	}
	var rows int64
	for {
		_, readErr := reader.Read()
		if readErr == io.EOF {
			return rows
		}
		if readErr != nil {
			// An I/O failure must not report a half count.
			return 0
		}
		rows++
	}
}

func readSample(reader *service.CSVReader, hasHeader bool, limit int) (columns []string, rows [][]string, truncated bool, err error) {
	first, err := reader.Read()
	if err == io.EOF {
		return nil, nil, false, fmt.Errorf("the file is empty")
	}
	if err != nil {
		return nil, nil, false, err
	}
	if hasHeader {
		columns = service.UniqueColumnNames(service.CSVValues(first))
	} else {
		columns = service.PositionalHeader(len(first))
		rows = append(rows, padRow(service.CSVValues(first), len(columns)))
	}
	for len(rows) < limit {
		rec, readErr := reader.Read()
		if readErr == io.EOF {
			return columns, rows, false, nil
		}
		if readErr != nil {
			// A malformed row shouldn't sink the preview; show what we have.
			return columns, rows, false, nil
		}
		rows = append(rows, padRow(service.CSVValues(rec), len(columns)))
	}
	if _, readErr := reader.Read(); readErr == nil {
		truncated = true
	}
	return columns, rows, truncated, nil
}

func padRow(row []string, width int) []string {
	out := make([]string, width)
	copy(out, row)
	return out
}

// Returns once the run is registered; import:progress and import:done carry the outcome.
func (a *App) ImportCSV(connectionID, importID string, req CSVImportRequest) error {
	if importID == "" {
		return fmt.Errorf("import id is required")
	}
	if req.Path == "" {
		return fmt.Errorf("no file selected")
	}
	if req.Table == "" {
		return fmt.Errorf("no target table")
	}
	if err := a.assertWritableConnection(connectionID); err != nil {
		return err
	}
	targets, sources, err := resolveMapping(req.Mapping)
	if err != nil {
		return err
	}
	a.runImport(importID, connectionID, func(ctx context.Context, em *importEmitter) (*ImportResult, error) {
		return a.runCSVImport(ctx, em, connectionID, req, targets, sources)
	})
	return nil
}

func resolveMapping(mapping []string) (targets []string, sources []int, err error) {
	seen := map[string]bool{}
	for i, target := range mapping {
		name := strings.TrimSpace(target)
		if name == "" {
			continue
		}
		if seen[strings.ToLower(name)] {
			return nil, nil, fmt.Errorf("column %q is mapped more than once", name)
		}
		seen[strings.ToLower(name)] = true
		targets = append(targets, name)
		sources = append(sources, i)
	}
	if len(targets) == 0 {
		return nil, nil, fmt.Errorf("map at least one column")
	}
	return targets, sources, nil
}

func (a *App) runCSVImport(
	ctx context.Context,
	em *importEmitter,
	connectionID string,
	req CSVImportRequest,
	targets []string,
	sources []int,
) (*ImportResult, error) {
	file, err := os.Open(req.Path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var totalBytes int64
	if info, statErr := file.Stat(); statErr == nil {
		totalBytes = info.Size()
	}
	// Before the byte counter, so bytesRead covers only the import's own pass.
	em.totalRows = countCSVRows(file, req.Options, totalBytes)
	counter := &countingReader{r: file}
	reader, err := service.NewCSVReader(counter, req.Options)
	if err != nil {
		return nil, err
	}

	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	schema := req.Schema
	batchSize := req.BatchSize
	if batchSize <= 0 {
		batchSize = defaultImportBatchSize
	}

	// Before any DDL, so a header-only file fails before creating a table.
	if req.Options.HasHeader {
		if _, hErr := reader.Read(); hErr != nil && hErr != io.EOF {
			return nil, hErr
		}
	}

	if req.CreateTable {
		create, cErr := database.BuildImportCreateTable(
			s.DriverType(), schema, req.Table, targets, mappedTypes(req.ColumnTypes, sources))
		if cErr != nil {
			return nil, cErr
		}
		if _, cErr = s.Execute(ctx, create); cErr != nil {
			return nil, fmt.Errorf("create table: %w", cErr)
		}
	} else if req.Truncate {
		if _, tErr := s.Execute(ctx, database.BuildTruncate(s.DriverType(), schema, req.Table)); tErr != nil {
			return nil, fmt.Errorf("empty table: %w", tErr)
		}
	}

	conv := a.valueConverter(ctx, s, schema, req, targets, sources)
	result := &ImportResult{}
	batch := make([][]any, 0, batchSize)

	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		inserted, skipped, errs := a.insertBatch(ctx, s, schema, req.Table, targets, batch, req.StopOnError)
		result.Inserted += inserted
		result.Skipped += skipped
		appendErrors(result, errs)
		batch = batch[:0]
		if req.StopOnError && skipped > 0 {
			return fmt.Errorf("%s", firstError(errs))
		}
		return nil
	}

	var processed int64
	for {
		if ctx.Err() != nil {
			result.Cancelled = true
			break
		}
		record, readErr := reader.Read()
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			if req.StopOnError {
				return nil, readErr
			}
			result.Skipped++
			appendErrors(result, []string{readErr.Error()})
			continue
		}
		processed++
		batch = append(batch, conv.buildValues(record, sources))
		if len(batch) >= batchSize {
			if fErr := flush(); fErr != nil {
				return nil, fErr
			}
		}
		// Throttled, so a file smaller than one batch still reports progress.
		em.progress(processed, result.Inserted, result.Skipped, counter.n.Load(), totalBytes)
	}
	if !result.Cancelled {
		if fErr := flush(); fErr != nil {
			return nil, fErr
		}
	}
	em.progressNow(processed, result.Inserted, result.Skipped, counter.n.Load(), totalBytes)
	return result, nil
}

// A failed batch is retried row by row, so one bad row costs only itself.
func (a *App) insertBatch(
	ctx context.Context,
	s database.Session,
	schema, table string,
	targets []string,
	batch [][]any,
	stopOnError bool,
) (inserted, skipped int64, errs []string) {
	if err := execInsert(ctx, s, schema, table, targets, batch); err == nil {
		return int64(len(batch)), 0, nil
	} else if stopOnError || ctx.Err() != nil {
		return 0, int64(len(batch)), []string{err.Error()}
	}
	for _, row := range batch {
		if err := execInsert(ctx, s, schema, table, targets, [][]any{row}); err != nil {
			skipped++
			errs = append(errs, err.Error())
			continue
		}
		inserted++
	}
	return inserted, skipped, errs
}

func execInsert(ctx context.Context, s database.Session, schema, table string, targets []string, rows [][]any) error {
	stmt, args, err := database.BuildBatchInsert(s.DriverType(), schema, table, targets, rows)
	if err != nil {
		return err
	}
	return s.ExecuteArgs(ctx, stmt, args)
}

// valueConv turns one CSV record into insert parameters; built once per run.
type valueConv struct {
	// boolCols hit real boolean columns; boolIntCols load bool-shaped data into numerics as 1/0.
	boolCols    map[int]bool
	boolIntCols map[int]bool
	// dateCols need MySQL's datetime literal rather than RFC 3339.
	dateCols map[int]bool
	// textCols can hold ''; elsewhere a quoted empty field still means NULL.
	textCols    map[int]bool
	nullLiteral string
	trim        bool
	// pgx encodes only Go bools into Postgres booleans; MySQL/SQLite take 1/0.
	boolAsBool bool
}

// A quoted empty field is ”; a bare one is NULL - the distinction Postgres COPY csv draws.
func (c *valueConv) buildValues(record []service.CSVField, sources []int) []any {
	out := make([]any, len(sources))
	for i, src := range sources {
		if src >= len(record) {
			out[i] = nil
			continue
		}
		field := record[src]
		v := field.Value
		if c.trim {
			v = strings.TrimSpace(v)
		}
		if c.nullLiteral != "" && v == c.nullLiteral {
			out[i] = nil
			continue
		}
		if v == "" {
			if field.Quoted && c.textCols[i] {
				out[i] = ""
				continue
			}
			out[i] = nil
			continue
		}
		v = undefuseFormula(v)
		switch {
		case c.boolCols[i]:
			out[i] = normalizeBool(v, c.boolAsBool)
		case c.boolIntCols[i]:
			out[i] = normalizeBool(v, false)
		case c.dateCols[i]:
			out[i] = mysqlDateTime(v)
		default:
			out[i] = v
		}
	}
	return out
}

// Reverses the export's spreadsheet-formula guard (a leading ' before = + - @).
func undefuseFormula(v string) string {
	if len(v) < 2 || v[0] != '\'' {
		return v
	}
	switch v[1] {
	case '=', '+', '-', '@':
		return v[1:]
	}
	return v
}

// Rewrites RFC 3339 into the literal MySQL accepts; anything else passes through.
func mysqlDateTime(v string) string {
	if ts, err := time.Parse(time.RFC3339Nano, v); err == nil {
		return ts.Format("2006-01-02 15:04:05.999999")
	}
	return v
}

// New tables: types from the request; existing tables: the catalog.
func (a *App) valueConverter(
	ctx context.Context,
	s database.Session,
	schema string,
	req CSVImportRequest,
	targets []string,
	sources []int,
) *valueConv {
	conv := &valueConv{
		boolCols:    map[int]bool{},
		boolIntCols: map[int]bool{},
		dateCols:    map[int]bool{},
		textCols:    map[int]bool{},
		nullLiteral: req.Options.NullLiteral,
		trim:        req.Options.TrimSpace,
		boolAsBool:  s.DriverType() == database.DriverPostgres,
	}
	mysql := s.DriverType() == database.DriverMySQL
	reqBool := boolColumns(req.ColumnTypes, sources)

	if req.CreateTable {
		conv.boolCols = reqBool
		for i, src := range sources {
			t := database.ImportText
			if src < len(req.ColumnTypes) && req.ColumnTypes[src] != "" {
				t = database.ImportColumnType(req.ColumnTypes[src])
			}
			conv.textCols[i] = t == database.ImportText
			if mysql && (t == database.ImportDate || t == database.ImportTimestamp) {
				conv.dateCols[i] = true
			}
		}
		return conv
	}

	cols, err := s.ListColumns(ctx, schema, req.Table)
	if err != nil {
		// No catalog: raw strings everywhere, and honour the quoting.
		for i := range targets {
			conv.textCols[i] = true
		}
		return conv
	}
	byName := make(map[string]string, len(cols))
	for _, col := range cols {
		byName[strings.ToLower(col.Name)] = col.DataType
	}
	for i, target := range targets {
		dataType, known := byName[strings.ToLower(target)]
		conv.textCols[i] = !known || database.AcceptsEmptyString(dataType)
		upper := strings.ToUpper(strings.TrimSpace(dataType))
		switch {
		case strings.Contains(upper, "BOOL"):
			conv.boolCols[i] = true
		case reqBool[i] && !conv.textCols[i]:
			// 1/0 into numerics; text targets keep the value as written.
			conv.boolIntCols[i] = true
		}
		if mysql {
			switch upper {
			case "DATE", "DATETIME", "TIMESTAMP":
				conv.dateCols[i] = true
			}
		}
	}
	return conv
}

// Unrecognised text passes through so the engine reports it rather than this rewriting data.
func normalizeBool(v string, asBool bool) any {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "t", "yes", "y", "1":
		if asBool {
			return true
		}
		return 1
	case "false", "f", "no", "n", "0":
		if asBool {
			return false
		}
		return 0
	}
	return v
}

func mappedTypes(columnTypes []string, sources []int) []database.ImportColumnType {
	out := make([]database.ImportColumnType, len(sources))
	for i, src := range sources {
		if src < len(columnTypes) && columnTypes[src] != "" {
			out[i] = database.ImportColumnType(columnTypes[src])
			continue
		}
		out[i] = database.ImportText
	}
	return out
}

func boolColumns(columnTypes []string, sources []int) map[int]bool {
	out := map[int]bool{}
	for i, src := range sources {
		if src < len(columnTypes) && database.ImportColumnType(columnTypes[src]) == database.ImportBool {
			out[i] = true
		}
	}
	return out
}

func appendErrors(result *ImportResult, errs []string) {
	for _, e := range errs {
		if len(result.Errors) >= maxReportedErrors {
			return
		}
		result.Errors = append(result.Errors, e)
	}
}

func firstError(errs []string) string {
	if len(errs) == 0 {
		return "import failed"
	}
	return errs[0]
}

// Reports progress instead of a result tab per statement; a dump can hold thousands.
func (a *App) ImportSQL(connectionID, importID string, req SQLImportRequest) error {
	if importID == "" {
		return fmt.Errorf("import id is required")
	}
	if req.Path == "" {
		return fmt.Errorf("no file selected")
	}
	if err := a.assertWritableConnection(connectionID); err != nil {
		return err
	}
	a.runImport(importID, connectionID, func(ctx context.Context, em *importEmitter) (*ImportResult, error) {
		return a.runSQLImport(ctx, em, connectionID, req)
	})
	return nil
}

func (a *App) runSQLImport(ctx context.Context, em *importEmitter, connectionID string, req SQLImportRequest) (*ImportResult, error) {
	// The splitter needs the whole script to track quoting, so it is read in full.
	data, err := os.ReadFile(req.Path)
	if err != nil {
		return nil, err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	statements := database.SplitStatements(s.DriverType(), string(data))
	total := int64(len(statements))

	pinned, err := s.PinnedConn(ctx)
	if err != nil {
		return nil, err
	}
	defer pinned.Close()

	result := &ImportResult{}
	for i, stmt := range statements {
		if ctx.Err() != nil {
			result.Cancelled = true
			break
		}
		// Rows discarded: the import reports counts, not result sets.
		res, execErr := pinned.ExecuteStream(ctx, stmt, database.StreamOpts{
			OnBatch: func([][]any) error { return nil },
		})
		if execErr != nil {
			if req.StopOnError {
				return nil, fmt.Errorf("statement %d: %w", i+1, execErr)
			}
			result.Skipped++
			appendErrors(result, []string{fmt.Sprintf("statement %d: %v", i+1, execErr)})
		} else {
			result.Statements++
			if res != nil {
				result.Inserted += res.AffectedRows
			}
		}
		// No byte progress per statement, so the index drives the bar.
		em.progress(int64(i+1), result.Inserted, result.Skipped, int64(i+1), total)
	}
	return result, nil
}

type importEmitter struct {
	app       *App
	importID  string
	seq       int
	totalRows int64
	lastEmit  time.Time
}

func (e *importEmitter) nextSeq() int {
	seq := e.seq
	e.seq++
	return seq
}

// Safe to call per row: drops anything arriving inside progressInterval.
func (e *importEmitter) progress(processed, inserted, skipped, bytesRead, totalBytes int64) {
	if time.Since(e.lastEmit) < progressInterval {
		return
	}
	e.progressNow(processed, inserted, skipped, bytesRead, totalBytes)
}

func (e *importEmitter) progressNow(processed, inserted, skipped, bytesRead, totalBytes int64) {
	e.lastEmit = time.Now()
	e.app.emit("import:progress", ImportProgressEvent{
		Seq:        e.nextSeq(),
		ImportID:   e.importID,
		Processed:  processed,
		Inserted:   inserted,
		Skipped:    skipped,
		BytesRead:  bytesRead,
		TotalBytes: totalBytes,
		TotalRows:  e.totalRows,
	})
}

func (e *importEmitter) done(result *ImportResult, err error) {
	payload := ImportDoneEvent{Seq: e.nextSeq(), ImportID: e.importID, Result: result}
	if err != nil {
		payload.Error = err.Error()
	}
	e.app.emit("import:done", payload)
}

// Registers on the connection so CancelQuery stops it, like any long query.
func (a *App) runImport(importID, connectionID string, fn func(ctx context.Context, em *importEmitter) (*ImportResult, error)) {
	_, ctx, end := a.queryContext(connectionID)
	em := &importEmitter{app: a, importID: importID}
	go func() {
		defer end()
		defer func() {
			if r := recover(); r != nil {
				em.done(nil, fmt.Errorf("import panicked: %v", r))
			}
		}()
		result, err := fn(ctx, em)
		if err != nil && errors.Is(err, context.Canceled) {
			em.done(&ImportResult{Cancelled: true}, nil)
			return
		}
		em.done(result, err)
	}()
}
