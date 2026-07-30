import * as api from "@/lib/backend/api";
import { aiDataDictionaryStructureSignature, aiDataDictionaryTableKey, aiDataDictionaryTableSignature, findAiDataDictionaryTable, listAiDataDictionaryRegistry, loadAiDataDictionary, saveAiDataDictionary, type AiDataDictionarySnapshot, type AiDataDictionaryTable } from "@/lib/ai/dataDictionary";
import { isSchemaAware } from "@/lib/database/databaseCapabilities";
import { effectiveDatabaseTypeForConnection } from "@/lib/database/jdbcDialect";
import { productionContextForDatabase } from "@/lib/database/productionSafety";
import type { ConnectionConfig, DatabaseType, TableInfo } from "@/types/database";
import { normalizeAiDataDictionaryRefreshHours, type AiDataDictionaryRefreshHours } from "@/lib/ai/dataDictionaryRefreshConfig";

export { AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS, normalizeAiDataDictionaryRefreshHours, type AiDataDictionaryRefreshHours } from "@/lib/ai/dataDictionaryRefreshConfig";
export const AI_DATA_DICTIONARY_PRODUCTION_MIN_HOURS = 12;
export const AI_DATA_DICTIONARY_NORMAL_TABLE_CAP = 20;
export const AI_DATA_DICTIONARY_PRODUCTION_TABLE_CAP = 5;

const FAILURE_BACKOFF_BASE_MS = 5 * 60 * 1000;
const FAILURE_BACKOFF_MAX_MS = 60 * 60 * 1000;
const UNSUPPORTED_DATABASE_TYPES = new Set<DatabaseType>(["redis", "mongodb", "qdrant", "milvus", "weaviate", "chromadb"]);

export interface AiDataDictionaryRefreshConnectionSource {
  getConfig(connectionId: string): ConnectionConfig | undefined;
  isConnected(connectionId: string): boolean;
}

export interface AiDataDictionaryRefreshSummary {
  dictionaries: number;
  changedTables: number;
  newTables: number;
  deletedTables: number;
  unchangedTables: number;
  failedTables: number;
  skippedDisconnected: number;
  skippedNotDue: number;
  skippedUnsupported: number;
  missingDictionaries: number;
}

export interface RefreshRegisteredAiDataDictionariesOptions {
  connectionSource: AiDataDictionaryRefreshConnectionSource;
  refreshHours: unknown;
  force?: boolean;
  now?: number;
}

interface LiveDictionaryTable {
  schema?: string;
  querySchema: string;
  table: TableInfo;
}

interface SnapshotRefreshResult {
  changedTables: number;
  newTables: number;
  deletedTables: number;
  unchangedTables: number;
  failedTables: number;
}

export function effectiveAiDataDictionaryRefreshHours(value: unknown, production: boolean): AiDataDictionaryRefreshHours {
  const normalized = normalizeAiDataDictionaryRefreshHours(value);
  if (normalized === 0 || !production) return normalized;
  return Math.max(normalized, AI_DATA_DICTIONARY_PRODUCTION_MIN_HOURS) as AiDataDictionaryRefreshHours;
}

export function aiDataDictionaryFailureBackoffMs(consecutiveFailures: number | undefined): number {
  const exponent = Math.max(0, Math.min(10, Math.floor(consecutiveFailures ?? 1) - 1));
  return Math.min(FAILURE_BACKOFF_MAX_MS, FAILURE_BACKOFF_BASE_MS * 2 ** exponent);
}

export function aiDataDictionaryRefreshIsDue(snapshot: AiDataDictionarySnapshot, refreshHours: unknown, production: boolean, now = Date.now()): boolean {
  const hours = effectiveAiDataDictionaryRefreshHours(refreshHours, production);
  if (hours === 0) return false;
  const intervalDueAt = (snapshot.lastReconciledAt ?? snapshot.updatedAt) + hours * 60 * 60 * 1000;
  const backoffDueAt = snapshot.lastRefreshErrorAt ? snapshot.lastRefreshErrorAt + aiDataDictionaryFailureBackoffMs(snapshot.consecutiveRefreshFailures) : 0;
  return now >= Math.max(intervalDueAt, backoffDueAt);
}

export function emptyAiDataDictionaryRefreshSummary(): AiDataDictionaryRefreshSummary {
  return {
    dictionaries: 0,
    changedTables: 0,
    newTables: 0,
    deletedTables: 0,
    unchangedTables: 0,
    failedTables: 0,
    skippedDisconnected: 0,
    skippedNotDue: 0,
    skippedUnsupported: 0,
    missingDictionaries: 0,
  };
}

let registeredRefreshInFlight: Promise<AiDataDictionaryRefreshSummary> | undefined;

export function refreshRegisteredAiDataDictionaries(options: RefreshRegisteredAiDataDictionariesOptions): Promise<AiDataDictionaryRefreshSummary> {
  if (registeredRefreshInFlight) return registeredRefreshInFlight;
  registeredRefreshInFlight = runRegisteredRefresh(options).finally(() => {
    registeredRefreshInFlight = undefined;
  });
  return registeredRefreshInFlight;
}

async function runRegisteredRefresh(options: RefreshRegisteredAiDataDictionariesOptions): Promise<AiDataDictionaryRefreshSummary> {
  const summary = emptyAiDataDictionaryRefreshSummary();
  const now = options.now ?? Date.now();
  const registry = await listAiDataDictionaryRegistry();

  for (const entry of registry) {
    const connection = options.connectionSource.getConfig(entry.connectionId);
    if (!connection) {
      summary.missingDictionaries += 1;
      continue;
    }
    const databaseType = effectiveDatabaseTypeForConnection(connection) ?? connection.db_type;
    if (UNSUPPORTED_DATABASE_TYPES.has(databaseType)) {
      summary.skippedUnsupported += 1;
      continue;
    }
    if (!options.connectionSource.isConnected(entry.connectionId)) {
      summary.skippedDisconnected += 1;
      continue;
    }
    const snapshot = await loadAiDataDictionary(entry.connectionId, entry.database);
    if (!snapshot) {
      summary.missingDictionaries += 1;
      continue;
    }
    const production = productionContextForDatabase(connection, entry.database).active;
    if (!options.force && !aiDataDictionaryRefreshIsDue(snapshot, options.refreshHours, production, now)) {
      summary.skippedNotDue += 1;
      continue;
    }

    const tableCap = production ? AI_DATA_DICTIONARY_PRODUCTION_TABLE_CAP : AI_DATA_DICTIONARY_NORMAL_TABLE_CAP;
    const result = await refreshAiDataDictionarySnapshot(snapshot, connection, tableCap, now);
    summary.dictionaries += 1;
    summary.changedTables += result.changedTables;
    summary.newTables += result.newTables;
    summary.deletedTables += result.deletedTables;
    summary.unchangedTables += result.unchangedTables;
    summary.failedTables += result.failedTables;
  }

  return summary;
}

export async function refreshAiDataDictionarySnapshot(snapshot: AiDataDictionarySnapshot, connection: ConnectionConfig, tableCap: number, now = Date.now()): Promise<SnapshotRefreshResult> {
  const result: SnapshotRefreshResult = {
    changedTables: 0,
    newTables: 0,
    deletedTables: 0,
    unchangedTables: 0,
    failedTables: 0,
  };

  try {
    const databaseType = effectiveDatabaseTypeForConnection(connection) ?? connection.db_type;
    const liveTables = await loadLiveDictionaryTables(snapshot.connectionId, snapshot.database, databaseType);
    const liveKeys = new Set(liveTables.map((item) => aiDataDictionaryTableKey(item.schema, item.table.name)));
    const before = snapshot.tables.length;
    snapshot.tables = snapshot.tables.filter((table) => liveKeys.has(aiDataDictionaryTableKey(table.schema, table.name)));
    result.deletedTables = before - snapshot.tables.length;

    const candidates = liveTables
      .map((live) => {
        const cached = findAiDataDictionaryTable(snapshot, live.schema, live.table.name);
        const tableSignature = aiDataDictionaryTableSignature(live.table);
        const priority = !cached ? 0 : cached.tableSignature !== tableSignature ? 1 : 2;
        return { live, cached, tableSignature, priority, verifiedAt: cached?.verifiedAt ?? cached?.scannedAt ?? 0 };
      })
      .sort((left, right) => left.priority - right.priority || left.verifiedAt - right.verifiedAt || aiDataDictionaryTableKey(left.live.schema, left.live.table.name).localeCompare(aiDataDictionaryTableKey(right.live.schema, right.live.table.name)))
      .slice(0, Math.max(0, tableCap));

    for (const candidate of candidates) {
      try {
        const scanned = await loadDictionaryTable(snapshot, candidate.live, now);
        const cachedSignature = candidate.cached ? (candidate.cached.structureSignature ?? aiDataDictionaryStructureSignature(candidate.cached)) : undefined;
        if (!candidate.cached) {
          snapshot.tables.push(scanned);
          result.newTables += 1;
        } else if (cachedSignature !== scanned.structureSignature) {
          const index = snapshot.tables.indexOf(candidate.cached);
          snapshot.tables[index] = scanned;
          result.changedTables += 1;
        } else {
          candidate.cached.verifiedAt = now;
          candidate.cached.structureSignature = cachedSignature;
          candidate.cached.tableSignature = candidate.tableSignature;
          result.unchangedTables += 1;
        }
      } catch {
        result.failedTables += 1;
      }
    }

    snapshot.connectionName = connection.name;
    snapshot.databaseType = databaseType;
    if (result.failedTables > 0) {
      snapshot.lastRefreshErrorAt = now;
      snapshot.consecutiveRefreshFailures = (snapshot.consecutiveRefreshFailures ?? 0) + 1;
    } else {
      snapshot.lastReconciledAt = now;
      snapshot.lastRefreshErrorAt = undefined;
      snapshot.consecutiveRefreshFailures = 0;
    }
  } catch {
    result.failedTables += 1;
    snapshot.lastRefreshErrorAt = now;
    snapshot.consecutiveRefreshFailures = (snapshot.consecutiveRefreshFailures ?? 0) + 1;
  }

  await saveAiDataDictionary(snapshot);
  return result;
}

async function loadLiveDictionaryTables(connectionId: string, database: string, databaseType: DatabaseType): Promise<LiveDictionaryTable[]> {
  const schemaAware = isSchemaAware(databaseType);
  const schemas = schemaAware ? await api.listSchemas(connectionId, database) : [database || "main"];
  // 2026-07-29 coder(lq): An empty schema list from a schema-aware database is
  // treated as a transient metadata failure, never as evidence that every cached table was deleted.
  if (schemaAware && schemas.length === 0) {
    throw new Error("Database metadata returned no schemas");
  }
  const tables: LiveDictionaryTable[] = [];
  for (const schema of schemas) {
    const schemaTables = await api.listTables(connectionId, database, schema);
    for (const table of schemaTables) {
      tables.push({
        schema: schemaAware ? schema : undefined,
        querySchema: schema,
        table,
      });
    }
  }
  return tables;
}

async function loadDictionaryTable(snapshot: AiDataDictionarySnapshot, live: LiveDictionaryTable, now: number): Promise<AiDataDictionaryTable> {
  const [columns, indexes, foreignKeys] = await Promise.all([
    api.getColumns(snapshot.connectionId, snapshot.database, live.querySchema, live.table.name),
    api.listIndexes(snapshot.connectionId, snapshot.database, live.querySchema, live.table.name),
    api.listForeignKeys(snapshot.connectionId, snapshot.database, live.querySchema, live.table.name),
  ]);
  const table: AiDataDictionaryTable = {
    schema: live.schema,
    name: live.table.name,
    tableType: live.table.table_type,
    comment: live.table.comment,
    columns,
    indexes,
    foreignKeys,
    scannedAt: now,
    verifiedAt: now,
    tableSignature: aiDataDictionaryTableSignature(live.table),
  };
  table.structureSignature = aiDataDictionaryStructureSignature(table);
  return table;
}
