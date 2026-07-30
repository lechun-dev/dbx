import type { DatabaseType } from "@/types/database";

export type AiDatabaseScope = { mode: "current" } | { mode: "selected"; databases: string[] } | { mode: "unscoped" };

export function parseAiDatabaseScope(value: unknown): AiDatabaseScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { mode?: unknown; databases?: unknown };
  if (candidate.mode === "current" || candidate.mode === "unscoped") {
    return { mode: candidate.mode };
  }
  if (candidate.mode !== "selected" || !Array.isArray(candidate.databases)) return undefined;

  // 2026-07-29 coder(lq): Conversation data can outlive the app version that
  // wrote it, so accept only a bounded string list before restoring SQL targets.
  const databases = candidate.databases.filter((database): database is string => typeof database === "string").slice(0, 100);
  return databases.length === candidate.databases.length ? { mode: "selected", databases } : undefined;
}

export function normalizeAiDatabaseScope(scope: AiDatabaseScope | undefined, currentDatabase: string): AiDatabaseScope {
  if (!scope || scope.mode === "current") return { mode: "current" };
  if (scope.mode === "unscoped") return { mode: "unscoped" };

  const seen = new Set<string>();
  const databases = scope.databases
    .map((database) => database.trim())
    .filter((database) => {
      const key = database.toLowerCase();
      if (!database || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!databases.length) return { mode: "unscoped" };
  if (databases.length === 1 && databases[0] === currentDatabase) return { mode: "selected", databases };
  return { mode: "selected", databases };
}

export function aiScopeDatabases(scope: AiDatabaseScope | undefined, currentDatabase: string): string[] {
  const normalized = normalizeAiDatabaseScope(scope, currentDatabase);
  if (normalized.mode === "current") return currentDatabase ? [currentDatabase] : [];
  return normalized.mode === "selected" ? normalized.databases : [];
}

export function aiScopeAllowsExecution(scope: AiDatabaseScope | undefined, currentDatabase: string): boolean {
  return aiScopeDatabases(scope, currentDatabase).length > 0;
}

export function aiScopeExecutionDatabase(scope: AiDatabaseScope | undefined, currentDatabase: string): string | undefined {
  const databases = aiScopeDatabases(scope, currentDatabase);
  return databases.length === 1 ? databases[0] : undefined;
}

export function aiDatabaseTypeSupportsCrossDatabaseSql(databaseType: DatabaseType): boolean {
  // 2026-07-29 coder(lq): Restrict automatic cross-database execution to dialects
  // whose normal table qualification can address another database/catalog.
  return ["mysql", "clickhouse", "doris", "starrocks", "gbase", "goldendb"].includes(databaseType);
}

export function aiScopeAllowsAgentExecution(scope: AiDatabaseScope | undefined, currentDatabase: string, databaseType: DatabaseType): boolean {
  const databases = aiScopeDatabases(scope, currentDatabase);
  return databases.length === 1 || (databases.length > 1 && aiDatabaseTypeSupportsCrossDatabaseSql(databaseType));
}
