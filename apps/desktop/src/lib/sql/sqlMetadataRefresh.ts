export type SqlMetadataRefreshScope = "none" | "connection" | "database";
export type SqlMetadataRefreshTarget = { scope: "none" } | { scope: "connection" } | { scope: "database"; schema?: string; table?: string };

const DATABASE_DDL_RE = /\b(CREATE|DROP)\s+DATABASE\b/i;
const SCHEMA_DDL_RE = /\b(CREATE|DROP)\s+SCHEMA\b/i;
const OBJECT_DDL_RE = /\b(CREATE|ALTER|DROP|RENAME)\s+(OR\s+REPLACE\s+)?(((GLOBAL|LOCAL)\s+)?TEMP(ORARY)?\s+)?(MATERIALIZED\s+)?(TABLE|VIEW|INDEX|SEQUENCE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\b/i;
const OBJECT_NAME_DDL_RE =
  /\b(?:CREATE|ALTER|DROP|RENAME)\s+(?:OR\s+REPLACE\s+)?(?:(?:(?:GLOBAL|LOCAL)\s+)?TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW|SEQUENCE|PROCEDURE|FUNCTION|TRIGGER|TYPE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?((?:(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))/i;
const INDEX_TABLE_DDL_RE =
  /\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+ON|DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s+ON)\s+((?:(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))/i;
const COMMENT_DDL_RE = /\bCOMMENT\s+ON\s+(?:(?:MATERIALIZED\s+)?VIEW|TABLE|COLUMN)\b/i;
const COMMENT_TABLE_DDL_RE = /\bCOMMENT\s+ON\s+(?:(?:MATERIALIZED\s+)?VIEW|TABLE)\s+((?:(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))/i;
const COMMENT_COLUMN_DDL_RE = /\bCOMMENT\s+ON\s+COLUMN\s+((?:(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)\s*\.\s*)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*))\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w$]*)/i;

function stripSqlMetadataComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ")
    .replace(/#.*$/gm, " ");
}

export function sqlMetadataRefreshScope(sql: string): SqlMetadataRefreshScope {
  return sqlMetadataRefreshTarget(sql).scope;
}

function splitSqlMetadataStatements(sql: string): string[] {
  return stripSqlMetadataComments(sql)
    .split(";")
    .map((stmt) => stmt.trim())
    .filter(Boolean);
}

function unquoteIdentifier(identifier: string): string {
  const trimmed = identifier.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("`") && trimmed.endsWith("`")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function objectPartsFromName(name: string): { schema?: string; table: string } {
  const parts = name.split(".").map((part) => unquoteIdentifier(part.trim()));
  if (parts.length >= 2) return { schema: parts[0], table: parts[parts.length - 1] };
  return { table: parts[0] };
}

function objectTargetFromDdl(statement: string): { schema?: string; table: string } | undefined {
  const match = statement.match(COMMENT_COLUMN_DDL_RE) || statement.match(COMMENT_TABLE_DDL_RE) || statement.match(INDEX_TABLE_DDL_RE) || statement.match(OBJECT_NAME_DDL_RE);
  return match?.[1] ? objectPartsFromName(match[1]) : undefined;
}

export function sqlMetadataRefreshTarget(sql: string, activeSchema?: string): SqlMetadataRefreshTarget {
  const statements = splitSqlMetadataStatements(sql);
  if (statements.some((stmt) => DATABASE_DDL_RE.test(stmt))) return { scope: "connection" };

  const schemaTargets = new Set<string>();
  const tableTargets = new Map<string, string>();
  let hasDatabaseRefresh = false;

  for (const statement of statements) {
    if (SCHEMA_DDL_RE.test(statement)) {
      hasDatabaseRefresh = true;
      continue;
    }
    if (!OBJECT_DDL_RE.test(statement) && !COMMENT_DDL_RE.test(statement)) continue;
    hasDatabaseRefresh = true;
    const objectTarget = objectTargetFromDdl(statement);
    const schema = objectTarget?.schema || activeSchema;
    if (schema) schemaTargets.add(schema);
    if (objectTarget?.table) {
      tableTargets.set(`${(schema ?? "").toLowerCase()}\u0000${objectTarget.table.toLowerCase()}`, objectTarget.table);
    }
  }

  if (!hasDatabaseRefresh) return { scope: "none" };
  if (tableTargets.size === 1) {
    const table = [...tableTargets.values()][0];
    return { scope: "database", schema: schemaTargets.size === 1 ? [...schemaTargets][0] : undefined, table };
  }
  if (schemaTargets.size === 1) return { scope: "database", schema: [...schemaTargets][0] };
  return { scope: "database" };
}
