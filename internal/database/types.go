package database

type DriverType string

const (
	DriverSQLite   DriverType = "sqlite"
	DriverPostgres DriverType = "postgres"
	DriverMySQL    DriverType = "mysql" // MariaDB uses the same driver
)

type ConnectionConfig struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Driver   DriverType `json:"driver"`
	Color    string     `json:"color"`
	FolderID string     `json:"folderId,omitempty"`

	// SQLite
	FilePath string `json:"filePath,omitempty"`

	// PostgreSQL / MySQL / MariaDB
	Host     string `json:"host,omitempty"`
	Port     int    `json:"port,omitempty"`
	Database string `json:"database,omitempty"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
	SSLMode  string `json:"sslMode,omitempty"`
	Schema   string `json:"schema,omitempty"`

	// Statement-level gate only - does not block side-effecting functions inside SELECT (e.g. pg_terminate_backend).
	// Pair with a restricted DB role for hard isolation.
	ReadOnly bool `json:"readOnly,omitempty"`
}

type ColumnInfo struct {
	Name          string `json:"name"`
	DataType      string `json:"dataType"`
	IsNullable    bool   `json:"isNullable"`
	IsPrimary     bool   `json:"isPrimary"`
	IsForeign     bool   `json:"isForeign"`
	ForeignTable  string `json:"foreignTable,omitempty"`
	ForeignColumn string `json:"foreignColumn,omitempty"`
	DefaultVal    string `json:"defaultVal,omitempty"`
}

type TableInfo struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
	Type   string `json:"type"`
}

type SchemaInfo struct {
	Name string `json:"name"`
}

type SchemaTables struct {
	Schema string      `json:"schema"`
	Tables []TableInfo `json:"tables"`
}

type SchemaBundle struct {
	Status       ConnectionStatus `json:"status"`
	Schemas      []SchemaInfo     `json:"schemas"`
	LoadedTables []SchemaTables   `json:"loadedTables"`
}

type ConnectionStatus struct {
	Connected bool   `json:"connected"`
	Database  string `json:"database"`
	Schema    string `json:"schema"`
	User      string `json:"user"`
	Host      string `json:"host,omitempty"`
}

type QueryResult struct {
	Columns      []string `json:"columns"`
	ColumnTypes  []string `json:"columnTypes"`
	Rows         [][]any  `json:"rows"`
	RowCount     int64    `json:"rowCount"`
	AffectedRows int64    `json:"affectedRows"`
	DurationMs   int64    `json:"durationMs"`
	Message      string   `json:"message,omitempty"`
	PrimaryKeys  []string `json:"primaryKeys,omitempty"`
	TableName    string   `json:"tableName,omitempty"`
	SchemaName   string   `json:"schemaName,omitempty"`
}

type TableDataRequest struct {
	Schema   string `json:"schema"`
	Table    string `json:"table"`
	Offset   int    `json:"offset"`
	Limit    int    `json:"limit"`
	OrderBy  string `json:"orderBy,omitempty"`
	OrderDir string `json:"orderDir,omitempty"`
	Filter   string `json:"filter,omitempty"`
}

type RowUpdate struct {
	Schema     string         `json:"schema"`
	Table      string         `json:"table"`
	PrimaryKey map[string]any `json:"primaryKey"`
	Changes    map[string]any `json:"changes"`
}

type RowDelete struct {
	Schema      string           `json:"schema"`
	Table       string           `json:"table"`
	PrimaryKeys []map[string]any `json:"primaryKeys"`
}

type HistoryEntry struct {
	ID           string `json:"id"`
	ConnectionID string `json:"connectionId"`
	SQL          string `json:"sql"`
	ExecutedAt   string `json:"executedAt"`
	DurationMs   int64  `json:"durationMs"`
	Success      bool   `json:"success"`
	Error        string `json:"error,omitempty"`
}

type SavedQuery struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ConnectionID string `json:"connectionId,omitempty"`
	SQL          string `json:"sql"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
}
