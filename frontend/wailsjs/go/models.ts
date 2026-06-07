export namespace database {
	
	export class ColumnInfo {
	    name: string;
	    dataType: string;
	    isNullable: boolean;
	    isPrimary: boolean;
	    isForeign: boolean;
	    defaultVal?: string;
	
	    static createFrom(source: any = {}) {
	        return new ColumnInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.dataType = source["dataType"];
	        this.isNullable = source["isNullable"];
	        this.isPrimary = source["isPrimary"];
	        this.isForeign = source["isForeign"];
	        this.defaultVal = source["defaultVal"];
	    }
	}
	export class ConnectionConfig {
	    id: string;
	    name: string;
	    driver: string;
	    color: string;
	    folderId?: string;
	    filePath?: string;
	    host?: string;
	    port?: number;
	    database?: string;
	    username?: string;
	    password?: string;
	    sslMode?: string;
	    schema?: string;
	    readOnly?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.driver = source["driver"];
	        this.color = source["color"];
	        this.folderId = source["folderId"];
	        this.filePath = source["filePath"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.database = source["database"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.sslMode = source["sslMode"];
	        this.schema = source["schema"];
	        this.readOnly = source["readOnly"];
	    }
	}
	export class ConnectionStatus {
	    connected: boolean;
	    database: string;
	    schema: string;
	    user: string;
	    host?: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.connected = source["connected"];
	        this.database = source["database"];
	        this.schema = source["schema"];
	        this.user = source["user"];
	        this.host = source["host"];
	    }
	}
	export class HistoryEntry {
	    id: string;
	    connectionId: string;
	    sql: string;
	    executedAt: string;
	    durationMs: number;
	    success: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new HistoryEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.sql = source["sql"];
	        this.executedAt = source["executedAt"];
	        this.durationMs = source["durationMs"];
	        this.success = source["success"];
	        this.error = source["error"];
	    }
	}
	export class QueryResult {
	    columns: string[];
	    columnTypes: string[];
	    rows: any[][];
	    rowCount: number;
	    affectedRows: number;
	    durationMs: number;
	    message?: string;
	    primaryKeys?: string[];
	    tableName?: string;
	    schemaName?: string;
	
	    static createFrom(source: any = {}) {
	        return new QueryResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = source["columns"];
	        this.columnTypes = source["columnTypes"];
	        this.rows = source["rows"];
	        this.rowCount = source["rowCount"];
	        this.affectedRows = source["affectedRows"];
	        this.durationMs = source["durationMs"];
	        this.message = source["message"];
	        this.primaryKeys = source["primaryKeys"];
	        this.tableName = source["tableName"];
	        this.schemaName = source["schemaName"];
	    }
	}
	export class RowDelete {
	    schema: string;
	    table: string;
	    primaryKeys: any[];
	
	    static createFrom(source: any = {}) {
	        return new RowDelete(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.primaryKeys = source["primaryKeys"];
	    }
	}
	export class RowUpdate {
	    schema: string;
	    table: string;
	    primaryKey: Record<string, any>;
	    changes: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new RowUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.primaryKey = source["primaryKey"];
	        this.changes = source["changes"];
	    }
	}
	export class SavedQuery {
	    id: string;
	    name: string;
	    connectionId?: string;
	    sql: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new SavedQuery(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.connectionId = source["connectionId"];
	        this.sql = source["sql"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}
	export class TableInfo {
	    schema: string;
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new TableInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class SchemaTables {
	    schema: string;
	    tables: TableInfo[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaTables(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.tables = this.convertValues(source["tables"], TableInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SchemaInfo {
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new SchemaInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	    }
	}
	export class SchemaBundle {
	    status: ConnectionStatus;
	    schemas: SchemaInfo[];
	    loadedTables: SchemaTables[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaBundle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = this.convertValues(source["status"], ConnectionStatus);
	        this.schemas = this.convertValues(source["schemas"], SchemaInfo);
	        this.loadedTables = this.convertValues(source["loadedTables"], SchemaTables);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class TableDataRequest {
	    schema: string;
	    table: string;
	    offset: number;
	    limit: number;
	    orderBy?: string;
	    orderDir?: string;
	    filter?: string;
	
	    static createFrom(source: any = {}) {
	        return new TableDataRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.offset = source["offset"];
	        this.limit = source["limit"];
	        this.orderBy = source["orderBy"];
	        this.orderDir = source["orderDir"];
	        this.filter = source["filter"];
	    }
	}

}

export namespace main {
	
	export class AppInfo {
	    name: string;
	    version: string;
	    author: string;
	    email: string;
	    repository: string;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new AppInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.author = source["author"];
	        this.email = source["email"];
	        this.repository = source["repository"];
	        this.description = source["description"];
	    }
	}

}

export namespace storage {
	
	export class ConnectionFolder {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectionFolder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class TableViewRef {
	    schema: string;
	    table: string;
	    filter?: string;
	    orderBy?: string;
	    orderDir?: string;
	
	    static createFrom(source: any = {}) {
	        return new TableViewRef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema = source["schema"];
	        this.table = source["table"];
	        this.filter = source["filter"];
	        this.orderBy = source["orderBy"];
	        this.orderDir = source["orderDir"];
	    }
	}
	export class EditorTab {
	    id: string;
	    connectionId: string;
	    title: string;
	    sql: string;
	    color: string;
	    savedQueryId?: string;
	    savedSqlBaseline?: string;
	    tableView?: TableViewRef;
	
	    static createFrom(source: any = {}) {
	        return new EditorTab(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.connectionId = source["connectionId"];
	        this.title = source["title"];
	        this.sql = source["sql"];
	        this.color = source["color"];
	        this.savedQueryId = source["savedQueryId"];
	        this.savedSqlBaseline = source["savedSqlBaseline"];
	        this.tableView = this.convertValues(source["tableView"], TableViewRef);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class EditorSession {
	    tabs: EditorTab[];
	    activeTab: string;
	
	    static createFrom(source: any = {}) {
	        return new EditorSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tabs = this.convertValues(source["tabs"], EditorTab);
	        this.activeTab = source["activeTab"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

