package app

import (
	"xensql/internal/database"
	"xensql/internal/storage"
)

func (a *App) getConnection(connectionID string) (database.ConnectionConfig, error) {
	store, err := a.requireStore()
	if err != nil {
		return database.ConnectionConfig{}, err
	}
	cfg, ok := store.GetConnection(connectionID)
	if !ok {
		return database.ConnectionConfig{}, errNotFound("connection")
	}
	return cfg, nil
}

func (a *App) ListConnections() []database.ConnectionConfig {
	if a.store == nil {
		return nil
	}
	return a.store.ListConnections()
}

func (a *App) SaveConnection(cfg database.ConnectionConfig) (database.ConnectionConfig, error) {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return database.ConnectionConfig{}, err
	}
	store, err := a.requireStore()
	if err != nil {
		return database.ConnectionConfig{}, err
	}
	saved, err := store.SaveConnection(cfg)
	if err != nil {
		return database.ConnectionConfig{}, err
	}
	a.pool.Disconnect(saved.ID)
	return saved, nil
}

func (a *App) DeleteConnection(id string) bool {
	a.pool.Disconnect(id)
	store, err := a.requireStore()
	if err != nil {
		return false
	}
	ok, err := store.DeleteConnection(id)
	if err != nil {
		return false
	}
	return ok
}

func (a *App) ReorderConnections(orderedIDs []string) bool {
	store, err := a.requireStore()
	if err != nil {
		return false
	}
	return store.ReorderConnections(orderedIDs) == nil
}

func (a *App) TestConnection(cfg database.ConnectionConfig) error {
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return err
	}
	driver, err := database.GetDriver(cfg.Driver)
	if err != nil {
		return err
	}
	return driver.TestConnection(a.ctx, cfg)
}

func (a *App) Connect(id string) error {
	cfg, err := a.getConnection(id)
	if err != nil {
		return err
	}
	database.NormalizeConnectionConfig(&cfg)
	if err := database.ValidateConnectionConfig(cfg); err != nil {
		return err
	}
	return a.pool.Connect(a.ctx, cfg)
}

func (a *App) Disconnect(id string) {
	// Cancel before closing so the goroutine doesn't operate on a closed sql.DB.
	a.queries.Cancel(id)
	a.pool.Disconnect(id)
}

func (a *App) IsConnected(id string) bool {
	return a.pool.IsConnected(id)
}

func (a *App) GetConnectionStatus(connectionID string) (database.ConnectionStatus, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return database.ConnectionStatus{Connected: false}, err
	}
	st, err := s.ConnectionInfo(a.ctx)
	if err != nil {
		return database.ConnectionStatus{Connected: false}, err
	}
	st.Connected = true
	return st, nil
}

// LoadSchemaData preloads tables for the default browse schema; Postgres also preloads "public"
// so the schema browser is populated even when the default is a custom schema.
func (a *App) LoadSchemaData(connectionID string) (database.SchemaBundle, error) {
	cfg, err := a.getConnection(connectionID)
	if err != nil {
		return database.SchemaBundle{}, err
	}
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return database.SchemaBundle{}, err
	}
	status, err := s.ConnectionInfo(a.ctx)
	if err != nil {
		return database.SchemaBundle{}, err
	}
	status.Connected = true

	schemas, err := s.ListSchemas(a.ctx)
	if err != nil {
		return database.SchemaBundle{}, err
	}

	browseSchema := database.DefaultBrowseSchema(cfg)
	preload := map[string]bool{browseSchema: true}
	if cfg.Driver == database.DriverPostgres && browseSchema != "public" {
		preload["public"] = true
	}

	loaded := make([]database.SchemaTables, 0, len(preload))
	for _, sch := range schemas {
		if !preload[sch.Name] {
			continue
		}
		tables, err := s.ListTables(a.ctx, sch.Name)
		if err != nil {
			return database.SchemaBundle{}, err
		}
		loaded = append(loaded, database.SchemaTables{Schema: sch.Name, Tables: tables})
	}
	return database.SchemaBundle{
		Status:       status,
		Schemas:      schemas,
		LoadedTables: loaded,
	}, nil
}

func (a *App) ListSchemas(connectionID string) ([]database.SchemaInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	return s.ListSchemas(a.ctx)
}

func (a *App) ListTables(connectionID, schema string) ([]database.TableInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	return s.ListTables(a.ctx, schema)
}

func (a *App) ListColumns(connectionID, schema, table string) ([]database.ColumnInfo, error) {
	s, err := a.sessionFor(connectionID)
	if err != nil {
		return nil, err
	}
	return s.ListColumns(a.ctx, schema, table)
}

func (a *App) ListFolders() []storage.ConnectionFolder {
	if a.store == nil {
		return nil
	}
	return a.store.ListFolders()
}

func (a *App) SaveFolder(f storage.ConnectionFolder) storage.ConnectionFolder {
	store, err := a.requireStore()
	if err != nil {
		return f
	}
	saved, err := store.SaveFolder(f)
	if err != nil {
		return f
	}
	return saved
}

func (a *App) DeleteFolder(id string) {
	store, err := a.requireStore()
	if err != nil {
		return
	}
	if err := store.DeleteFolder(id); err != nil {
		a.logErrorf("delete folder %s: %v", id, err)
	}
}

func (a *App) assertWritableConnection(connectionID string) error {
	cfg, err := a.getConnection(connectionID)
	if err != nil {
		return err
	}
	if cfg.ReadOnly {
		return database.ErrReadOnly
	}
	return nil
}

func (a *App) sessionFor(connectionID string) (database.Session, error) {
	if err := a.Connect(connectionID); err != nil {
		return nil, err
	}
	return a.pool.Session(connectionID)
}
