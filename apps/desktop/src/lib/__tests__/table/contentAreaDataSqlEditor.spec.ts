import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const contentAreaSource = readFileSync(new URL("../../../components/layout/ContentArea.vue", import.meta.url), "utf8");

describe("ContentArea data SQL editor", () => {
  it("renders a resizable SQL editor above the data result grid", () => {
    expect(contentAreaSource).toContain('@resized="onDataResultsResized"');
    expect(contentAreaSource).toContain(':size="dataEditorPaneSize"');
    expect(contentAreaSource).toContain(':size="dataSqlEditorVisible ? dataResultsPaneSize : 100"');
    expect(contentAreaSource).toContain(':model-value="activeTab.sql"');
    expect(contentAreaSource).toContain("@execute=\"emit('execute', $event)\"");
  });

  it("keeps the SQL editor toggle closed by default and persists the user's choice", () => {
    expect(contentAreaSource).toContain('const DATA_SQL_EDITOR_VISIBLE_STORAGE_KEY = "dbx-data-sql-editor-visible"');
    expect(contentAreaSource).toContain('safeLocalStorageGet(DATA_SQL_EDITOR_VISIBLE_STORAGE_KEY) === "true"');
    expect(contentAreaSource).toContain("safeLocalStorageSet(DATA_SQL_EDITOR_VISIBLE_STORAGE_KEY, String(dataSqlEditorVisible.value))");
    expect(contentAreaSource).toContain(':aria-pressed="dataSqlEditorVisible"');
    expect(contentAreaSource).toContain('<Pane v-if="dataSqlEditorVisible" key="data-sql-editor"');
    expect(contentAreaSource).toContain(':min-size="dataSqlEditorVisible ? 30 : 100"');
  });

  it("keeps custom SQL results detached from table editing metadata", () => {
    expect(contentAreaSource).toContain(':editable="!isCustomDataSql');
    expect(contentAreaSource).toContain(":context=\"isCustomDataSql ? 'results' : 'table-data'\"");
    expect(contentAreaSource).toContain(':table-meta="isCustomDataSql ? undefined : activeDataTabTableMeta"');
    expect(contentAreaSource).toContain(':full-export-result="isCustomDataSql ? undefined');
    expect(contentAreaSource).toContain(':sql="isCustomDataSql ? activeResultSql : activeTab.sql"');
  });
});
