import * as api from "@/lib/backend/api";
import type { ColumnInfo, DatabaseType, ForeignKeyInfo, IndexInfo, TableInfo } from "@/types/database";

export const AI_DATA_DICTIONARY_TTL_MS = 24 * 60 * 60 * 1000;
export const AI_DATA_DICTIONARY_MAX_STALE_REFRESH_PER_BUILD = 5;

const AI_DATA_DICTIONARY_VERSION = 1;
const AI_DATA_DICTIONARY_CACHE_PREFIX = `ai-data-dictionary:v${AI_DATA_DICTIONARY_VERSION}:`;
const AI_DATA_DICTIONARY_REGISTRY_KEY = `${AI_DATA_DICTIONARY_CACHE_PREFIX}registry`;

export interface AiDataDictionaryRegistryEntry {
  connectionId: string;
  database: string;
}

export interface AiDataDictionaryTable {
  schema?: string;
  name: string;
  tableType: string;
  comment?: string | null;
  columns: ColumnInfo[];
  indexes?: IndexInfo[];
  foreignKeys?: ForeignKeyInfo[];
  scannedAt: number;
  tableSignature: string;
  structureSignature?: string;
  verifiedAt?: number;
}

export interface AiDataDictionarySnapshot {
  version: 1;
  connectionId: string;
  connectionName: string;
  database: string;
  databaseType: DatabaseType;
  updatedAt: number;
  lastReconciledAt?: number;
  lastRefreshErrorAt?: number;
  consecutiveRefreshFailures?: number;
  tables: AiDataDictionaryTable[];
}

export interface AiDataDictionaryMarkdownFile {
  schema?: string;
  table: string;
  content: string;
}

export interface AiDataDictionaryMarkdownSyncRequest {
  connectionId: string;
  database: string;
  databaseType: string;
  updatedAt: number;
  files: AiDataDictionaryMarkdownFile[];
}

export interface AiDataDictionaryInvalidation {
  connectionId: string;
  database?: string;
  schema?: string;
  table?: string;
}

export function aiDataDictionaryCacheKey(connectionId: string, database: string): string {
  return `${AI_DATA_DICTIONARY_CACHE_PREFIX}${encodeURIComponent(connectionId)}:${encodeURIComponent(database)}`;
}

export function aiDataDictionaryConnectionPrefix(connectionId: string): string {
  return `${AI_DATA_DICTIONARY_CACHE_PREFIX}${encodeURIComponent(connectionId)}:`;
}

export function aiDataDictionaryTableKey(schema: string | undefined, table: string): string {
  return `${(schema ?? "").toLowerCase()}\u0000${table.toLowerCase()}`;
}

export function aiDataDictionaryTableSignature(table: Pick<TableInfo, "name" | "table_type" | "comment">): string {
  return JSON.stringify([table.name, table.table_type, table.comment ?? null]);
}

export function aiDataDictionaryStructureSignature(table: Pick<AiDataDictionaryTable, "name" | "tableType" | "comment" | "columns" | "indexes" | "foreignKeys">): string {
  const columns = table.columns.map((column) => [
    column.name,
    column.data_type,
    column.is_nullable,
    column.column_default ?? null,
    column.is_primary_key,
    column.extra ?? null,
    column.comment ?? null,
    column.numeric_precision ?? null,
    column.numeric_scale ?? null,
    column.character_maximum_length ?? null,
    column.enum_values ?? null,
    column.character_set ?? null,
    column.collation ?? null,
  ]);
  const indexes = (table.indexes ?? []).map((index) => [index.name, index.columns, index.is_unique, index.is_primary, index.filter ?? null, index.index_type ?? null, index.included_columns ?? null, index.comment ?? null]).sort(compareCanonicalRows);
  const foreignKeys = (table.foreignKeys ?? []).map((foreignKey) => [foreignKey.name, foreignKey.column, foreignKey.ref_schema ?? null, foreignKey.ref_table, foreignKey.ref_column, foreignKey.on_update ?? null, foreignKey.on_delete ?? null]).sort(compareCanonicalRows);
  return JSON.stringify([table.name, table.tableType, table.comment ?? null, columns, indexes, foreignKeys]);
}

export function createAiDataDictionarySnapshot(input: Omit<AiDataDictionarySnapshot, "version" | "updatedAt" | "tables">): AiDataDictionarySnapshot {
  return {
    version: AI_DATA_DICTIONARY_VERSION,
    ...input,
    updatedAt: Date.now(),
    tables: [],
  };
}

export async function loadAiDataDictionary(connectionId: string, database: string): Promise<AiDataDictionarySnapshot | undefined> {
  const value = await api.loadSchemaCache<unknown>(aiDataDictionaryCacheKey(connectionId, database)).catch(() => null);
  return isAiDataDictionarySnapshot(value) && value.connectionId === connectionId && value.database === database ? value : undefined;
}

export async function saveAiDataDictionary(snapshot: AiDataDictionarySnapshot): Promise<void> {
  snapshot.updatedAt = Date.now();
  await api.saveSchemaCache(aiDataDictionaryCacheKey(snapshot.connectionId, snapshot.database), snapshot);
  await registerAiDataDictionary(snapshot.connectionId, snapshot.database);
  // 2026-07-29 coder(lq): Markdown is a desktop convenience copy. Cache persistence must
  // remain successful on web builds or older desktop backends that do not expose this command.
  await api
    .syncAiDataDictionaryMarkdown({
      connectionId: snapshot.connectionId,
      database: snapshot.database,
      databaseType: snapshot.databaseType,
      updatedAt: snapshot.updatedAt,
      files: snapshot.tables.map((table) => ({
        schema: table.schema,
        table: table.name,
        content: aiDataDictionaryTableMarkdown(snapshot, table),
      })),
    })
    .catch(() => undefined);
}

export async function listAiDataDictionaryRegistry(): Promise<AiDataDictionaryRegistryEntry[]> {
  const value = await api.loadSchemaCache<unknown>(AI_DATA_DICTIONARY_REGISTRY_KEY).catch(() => null);
  return parseAiDataDictionaryRegistry(value);
}

export function parseAiDataDictionaryRegistry(value: unknown): AiDataDictionaryRegistryEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, AiDataDictionaryRegistryEntry>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<AiDataDictionaryRegistryEntry>;
    const connectionId = candidate.connectionId?.trim();
    const database = candidate.database?.trim();
    if (!connectionId || !database) continue;
    entries.set(aiDataDictionaryCacheKey(connectionId, database), { connectionId, database });
  }
  return [...entries.values()];
}

export function findAiDataDictionaryTable(snapshot: AiDataDictionarySnapshot | undefined, schema: string | undefined, table: string): AiDataDictionaryTable | undefined {
  if (!snapshot) return undefined;
  if (schema !== undefined) {
    const key = aiDataDictionaryTableKey(schema, table);
    return snapshot.tables.find((entry) => aiDataDictionaryTableKey(entry.schema, entry.name) === key);
  }
  const matches = snapshot.tables.filter((entry) => entry.name.toLowerCase() === table.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

export function upsertAiDataDictionaryTable(snapshot: AiDataDictionarySnapshot, table: AiDataDictionaryTable): void {
  table.structureSignature ??= aiDataDictionaryStructureSignature(table);
  table.verifiedAt ??= table.scannedAt;
  const key = aiDataDictionaryTableKey(table.schema, table.name);
  const index = snapshot.tables.findIndex((entry) => aiDataDictionaryTableKey(entry.schema, entry.name) === key);
  if (index >= 0) snapshot.tables[index] = table;
  else snapshot.tables.push(table);
}

export function reconcileAiDataDictionarySchema(snapshot: AiDataDictionarySnapshot, schema: string | undefined, currentTables: TableInfo[]): boolean {
  const currentKeys = new Set(currentTables.map((table) => aiDataDictionaryTableKey(schema, table.name)));
  const before = snapshot.tables.length;
  snapshot.tables = snapshot.tables.filter((entry) => {
    if ((entry.schema ?? "").toLowerCase() !== (schema ?? "").toLowerCase()) return true;
    return currentKeys.has(aiDataDictionaryTableKey(entry.schema, entry.name));
  });
  return snapshot.tables.length !== before;
}

export function shouldRefreshAiDataDictionaryTable(cached: AiDataDictionaryTable | undefined, table: TableInfo, now = Date.now()): "missing" | "signature" | "stale" | "fresh" {
  if (!cached) return "missing";
  if (cached.tableSignature !== aiDataDictionaryTableSignature(table)) return "signature";
  if (now - (cached.verifiedAt ?? cached.scannedAt) >= AI_DATA_DICTIONARY_TTL_MS) return "stale";
  return "fresh";
}

export function aiDataDictionaryTableMarkdown(snapshot: AiDataDictionarySnapshot, table: AiDataDictionaryTable): string {
  const qualifiedName = table.schema ? `${table.schema}.${table.name}` : table.name;
  const lines = [`# ${qualifiedName}`, "", `- Database: ${markdownText(snapshot.database)}`, `- Database type: ${markdownText(snapshot.databaseType)}`, `- Object type: ${markdownText(table.tableType)}`, `- Scanned at: ${new Date(table.scannedAt).toISOString()}`];
  if (table.comment) lines.push(`- Comment: ${markdownText(table.comment)}`);

  lines.push("", "## Columns", "", "| Name | Type | Nullable | Default | Primary key | Comment |", "| --- | --- | --- | --- | --- | --- |");
  for (const column of table.columns) {
    lines.push(`| ${markdownCell(column.name)} | ${markdownCell(column.data_type)} | ${column.is_nullable ? "yes" : "no"} | ${markdownCell(column.column_default ?? "")} | ${column.is_primary_key ? "yes" : "no"} | ${markdownCell(column.comment ?? "")} |`);
  }
  if (!table.columns.length) lines.push("| — | — | — | — | — | — |");

  lines.push("", "## Indexes", "");
  if (table.indexes?.length) {
    for (const index of table.indexes) {
      const flags = [index.is_primary ? "primary" : "", index.is_unique ? "unique" : ""].filter(Boolean).join(", ");
      lines.push(`- ${markdownText(index.name)}: ${index.columns.map(markdownText).join(", ")}${flags ? ` (${flags})` : ""}`);
    }
  } else {
    lines.push("- None");
  }

  lines.push("", "## Foreign keys", "");
  if (table.foreignKeys?.length) {
    for (const foreignKey of table.foreignKeys) {
      const target = [foreignKey.ref_schema, foreignKey.ref_table].filter(Boolean).join(".");
      lines.push(`- ${markdownText(foreignKey.name)}: ${markdownText(foreignKey.column)} → ${markdownText(target)}.${markdownText(foreignKey.ref_column)}`);
    }
  } else {
    lines.push("- None");
  }
  lines.push("");
  return lines.join("\n");
}

export async function invalidateAiDataDictionary(match: AiDataDictionaryInvalidation): Promise<void> {
  if (!match.database) {
    await api.deleteSchemaCachePrefix(aiDataDictionaryConnectionPrefix(match.connectionId));
    await unregisterAiDataDictionaries((entry) => entry.connectionId === match.connectionId);
    await api.clearAiDataDictionaryMarkdown(match.connectionId).catch(() => undefined);
    return;
  }

  const snapshot = await loadAiDataDictionary(match.connectionId, match.database);
  if (!snapshot) return;
  const schema = match.schema?.toLowerCase();
  const table = match.table?.toLowerCase();
  snapshot.tables = snapshot.tables.filter((entry) => {
    if (schema !== undefined && (entry.schema ?? "").toLowerCase() !== schema) return true;
    if (table !== undefined && entry.name.toLowerCase() !== table) return true;
    return false;
  });
  await saveAiDataDictionary(snapshot);
}

function isAiDataDictionarySnapshot(value: unknown): value is AiDataDictionarySnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiDataDictionarySnapshot>;
  return (
    candidate.version === AI_DATA_DICTIONARY_VERSION &&
    typeof candidate.connectionId === "string" &&
    typeof candidate.database === "string" &&
    typeof candidate.databaseType === "string" &&
    typeof candidate.updatedAt === "number" &&
    Array.isArray(candidate.tables) &&
    candidate.tables.every(isAiDataDictionaryTable)
  );
}

function isAiDataDictionaryTable(value: unknown): value is AiDataDictionaryTable {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AiDataDictionaryTable>;
  return typeof candidate.name === "string" && typeof candidate.tableType === "string" && Array.isArray(candidate.columns) && typeof candidate.scannedAt === "number" && typeof candidate.tableSignature === "string";
}

function markdownCell(value: string): string {
  return String(value).trim().replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function markdownText(value: string): string {
  return String(value).replace(/\r?\n/g, " ").trim();
}

let registryMutation = Promise.resolve();

async function registerAiDataDictionary(connectionId: string, database: string): Promise<void> {
  return mutateAiDataDictionaryRegistry((entries) => {
    entries.set(aiDataDictionaryCacheKey(connectionId, database), { connectionId, database });
  });
}

async function unregisterAiDataDictionaries(predicate: (entry: AiDataDictionaryRegistryEntry) => boolean): Promise<void> {
  return mutateAiDataDictionaryRegistry((entries) => {
    for (const [key, entry] of entries) {
      if (predicate(entry)) entries.delete(key);
    }
  });
}

function mutateAiDataDictionaryRegistry(mutate: (entries: Map<string, AiDataDictionaryRegistryEntry>) => void): Promise<void> {
  const next = registryMutation.then(async () => {
    const entries = new Map((await listAiDataDictionaryRegistry()).map((entry) => [aiDataDictionaryCacheKey(entry.connectionId, entry.database), entry]));
    mutate(entries);
    await api.saveSchemaCache(AI_DATA_DICTIONARY_REGISTRY_KEY, [...entries.values()]);
  });
  registryMutation = next.catch(() => undefined);
  return next;
}

function compareCanonicalRows(left: unknown[], right: unknown[]): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}
