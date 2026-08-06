package database

import "strings"

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

	// SSH tunnel (PostgreSQL / MySQL / MariaDB). Host/Port above are resolved from the bastion.
	SSH SSHConfig `json:"ssh,omitempty"`
}

type SSHAuthMethod string

const (
	SSHAuthPassword SSHAuthMethod = "password"
	SSHAuthKey      SSHAuthMethod = "key"
	SSHAuthAgent    SSHAuthMethod = "agent"
)

type SSHConfig struct {
	Enabled    bool          `json:"enabled,omitempty"`
	Host       string        `json:"host,omitempty"`
	Port       int           `json:"port,omitempty"`
	Username   string        `json:"username,omitempty"`
	Auth       SSHAuthMethod `json:"auth,omitempty"`
	Password   string        `json:"password,omitempty"`
	KeyPath    string        `json:"keyPath,omitempty"`
	Passphrase string        `json:"passphrase,omitempty"`
	// KnownHosts overrides the default ~/.ssh/known_hosts.
	KnownHosts string `json:"knownHosts,omitempty"`
	// IgnoreHostKey accepts any bastion key, leaving the hop open to interception.
	IgnoreHostKey bool `json:"ignoreHostKey,omitempty"`
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

type ObjectKind string

const (
	ObjectTable      ObjectKind = "table"
	ObjectView       ObjectKind = "view"
	ObjectMatView    ObjectKind = "materialized view"
	ObjectIndex      ObjectKind = "index"
	ObjectConstraint ObjectKind = "constraint"
	ObjectTrigger    ObjectKind = "trigger"
	ObjectFunction   ObjectKind = "function"
	ObjectProcedure  ObjectKind = "procedure"
)

func (k ObjectKind) IsRelation() bool {
	switch k {
	case ObjectTable, ObjectView, ObjectMatView:
		return true
	}
	return false
}

func RelationKind(tableType string) ObjectKind {
	switch ObjectKind(strings.ToLower(tableType)) {
	case ObjectView:
		return ObjectView
	case ObjectMatView:
		return ObjectMatView
	}
	return ObjectTable
}

type IndexInfo struct {
	Name      string   `json:"name"`
	Schema    string   `json:"schema"`
	Table     string   `json:"table"`
	Columns   []string `json:"columns"`
	IsPrimary bool     `json:"isPrimary"`
	IsUnique  bool     `json:"isUnique"`
	Method    string   `json:"method,omitempty"`
}

type ConstraintInfo struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Table  string `json:"table"`
	// Type is one of PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK.
	Type       string   `json:"type"`
	Columns    []string `json:"columns"`
	RefTable   string   `json:"refTable,omitempty"`
	RefColumns []string `json:"refColumns,omitempty"`
	// Definition is the engine's own rendering, where it exposes one.
	Definition string `json:"definition,omitempty"`
}

type TriggerInfo struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Table  string `json:"table"`
	// Timing is BEFORE / AFTER / INSTEAD OF; Events is the comma-joined event list.
	Timing string `json:"timing,omitempty"`
	Events string `json:"events,omitempty"`
}

type RoutineInfo struct {
	Name       string     `json:"name"`
	Schema     string     `json:"schema"`
	Kind       ObjectKind `json:"kind"`
	ReturnType string     `json:"returnType,omitempty"`
	Args       string     `json:"args,omitempty"`
}

// Table is set for index / constraint / trigger kinds only.
type ObjectRef struct {
	Schema string     `json:"schema"`
	Name   string     `json:"name"`
	Kind   ObjectKind `json:"kind"`
	Table  string     `json:"table,omitempty"`
	Args   string     `json:"args,omitempty"`
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
