import { describe, expect, it } from "vitest";
import type { ColumnInfo, TableInfo } from "@/types/database";
import {
  AI_DATA_DICTIONARY_MAX_STALE_REFRESH_PER_BUILD,
  AI_DATA_DICTIONARY_TTL_MS,
  aiDataDictionaryStructureSignature,
  aiDataDictionaryTableMarkdown,
  aiDataDictionaryTableSignature,
  createAiDataDictionarySnapshot,
  findAiDataDictionaryTable,
  parseAiDataDictionaryRegistry,
  reconcileAiDataDictionarySchema,
  shouldRefreshAiDataDictionaryTable,
  upsertAiDataDictionaryTable,
  type AiDataDictionaryTable,
} from "@/lib/ai/dataDictionary";

const column: ColumnInfo = {
  name: "id",
  data_type: "bigint",
  is_nullable: false,
  column_default: null,
  is_primary_key: true,
  extra: null,
};

const tableInfo: TableInfo = {
  name: "users",
  table_type: "TABLE",
  comment: "Customers",
};

function dictionaryTable(overrides: Partial<AiDataDictionaryTable> = {}): AiDataDictionaryTable {
  return {
    schema: "public",
    name: "users",
    tableType: "TABLE",
    comment: "Customers",
    columns: [column],
    indexes: [],
    foreignKeys: [],
    scannedAt: 1_000,
    tableSignature: aiDataDictionaryTableSignature(tableInfo),
    ...overrides,
  };
}

function snapshot() {
  return createAiDataDictionarySnapshot({
    connectionId: "connection",
    connectionName: "Local",
    database: "app",
    databaseType: "postgresql",
  });
}

describe("AI data dictionary", () => {
  it("distinguishes missing, changed, stale, and fresh tables", () => {
    expect(shouldRefreshAiDataDictionaryTable(undefined, tableInfo, 1_001)).toBe("missing");
    expect(shouldRefreshAiDataDictionaryTable(dictionaryTable(), { ...tableInfo, comment: "Changed" }, 1_001)).toBe("signature");
    expect(shouldRefreshAiDataDictionaryTable(dictionaryTable(), tableInfo, 1_000 + AI_DATA_DICTIONARY_TTL_MS)).toBe("stale");
    expect(shouldRefreshAiDataDictionaryTable(dictionaryTable({ verifiedAt: 1_000 + AI_DATA_DICTIONARY_TTL_MS - 1 }), tableInfo, 1_000 + AI_DATA_DICTIONARY_TTL_MS)).toBe("fresh");
    expect(shouldRefreshAiDataDictionaryTable(dictionaryTable(), tableInfo, 1_001)).toBe("fresh");
    expect(AI_DATA_DICTIONARY_MAX_STALE_REFRESH_PER_BUILD).toBe(5);
  });

  it("keeps same-named tables isolated by schema and removes deleted tables", () => {
    const value = snapshot();
    upsertAiDataDictionaryTable(value, dictionaryTable());
    upsertAiDataDictionaryTable(value, dictionaryTable({ schema: "audit" }));

    expect(findAiDataDictionaryTable(value, "public", "USERS")?.schema).toBe("public");
    expect(findAiDataDictionaryTable(value, undefined, "users")).toBeUndefined();
    expect(reconcileAiDataDictionarySchema(value, "public", [])).toBe(true);
    expect(value.tables).toHaveLength(1);
    expect(value.tables[0].schema).toBe("audit");
  });

  it("renders structure-only Markdown without connection secrets or row data", () => {
    const value = snapshot();
    const markdown = aiDataDictionaryTableMarkdown(
      value,
      dictionaryTable({
        comment: "Customer | master",
        columns: [{ ...column, comment: "Identifier\nline two" }],
      }),
    );

    expect(markdown).toContain("# public.users");
    expect(markdown).toContain("Customer | master");
    expect(markdown).toContain("Identifier<br>line two");
    expect(markdown).not.toContain("password");
    expect(markdown).not.toContain("connection string");
    expect(markdown).not.toContain("sample rows");
  });

  it("keeps structure signatures stable when indexes and foreign keys arrive in a different order", () => {
    const first = dictionaryTable({
      indexes: [
        { name: "idx_email", columns: ["email"], is_unique: true, is_primary: false },
        { name: "idx_name", columns: ["name"], is_unique: false, is_primary: false },
      ],
      foreignKeys: [
        { name: "fk_team", column: "team_id", ref_schema: "public", ref_table: "teams", ref_column: "id" },
        { name: "fk_owner", column: "owner_id", ref_schema: "public", ref_table: "users", ref_column: "id" },
      ],
    });
    const reordered = dictionaryTable({
      indexes: [...(first.indexes ?? [])].reverse(),
      foreignKeys: [...(first.foreignKeys ?? [])].reverse(),
    });

    expect(aiDataDictionaryStructureSignature(first)).toBe(aiDataDictionaryStructureSignature(reordered));
  });

  it("detects changes to columns, indexes, foreign keys, and table comments", () => {
    const base = dictionaryTable({
      indexes: [{ name: "idx_email", columns: ["email"], is_unique: true, is_primary: false }],
      foreignKeys: [{ name: "fk_team", column: "team_id", ref_schema: "public", ref_table: "teams", ref_column: "id" }],
    });
    const signature = aiDataDictionaryStructureSignature(base);

    expect(aiDataDictionaryStructureSignature(dictionaryTable({ ...base, columns: [{ ...column, data_type: "integer" }] }))).not.toBe(signature);
    expect(aiDataDictionaryStructureSignature(dictionaryTable({ ...base, indexes: [{ ...base.indexes![0], is_unique: false }] }))).not.toBe(signature);
    expect(aiDataDictionaryStructureSignature(dictionaryTable({ ...base, foreignKeys: [{ ...base.foreignKeys![0], on_delete: "CASCADE" }] }))).not.toBe(signature);
    expect(aiDataDictionaryStructureSignature(dictionaryTable({ ...base, comment: "Changed comment" }))).not.toBe(signature);
  });

  it("parses, trims, deduplicates, and filters registry entries", () => {
    expect(parseAiDataDictionaryRegistry([{ connectionId: " connection ", database: " app " }, { connectionId: "connection", database: "app" }, { connectionId: "", database: "app" }, { connectionId: "connection" }, null])).toEqual([{ connectionId: "connection", database: "app" }]);
  });
});
