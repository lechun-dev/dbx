import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRequestInput } from "@/lib/ai/ai";
import type { ConnectionConfig, QueryTab } from "@/types/database";

const mocks = vi.hoisted(() => ({
  aiStream: vi.fn(),
  aiAgentStream: vi.fn(),
  listTables: vi.fn(),
  getColumns: vi.fn(),
  listSchemas: vi.fn(),
  listIndexes: vi.fn(),
  listForeignKeys: vi.fn(),
}));

vi.mock("@/lib/backend/api", () => ({
  aiStream: mocks.aiStream,
  aiAgentStream: mocks.aiAgentStream,
  listTables: mocks.listTables,
  getColumns: mocks.getColumns,
  listSchemas: mocks.listSchemas,
  listIndexes: mocks.listIndexes,
  listForeignKeys: mocks.listForeignKeys,
}));

import { buildAiContext, runAgentStream } from "@/lib/ai/ai";

function unscopedInput(): AiRequestInput {
  return {
    config: {
      provider: "openai",
      apiKey: "test",
      authMethod: "bearer",
      endpoint: "https://example.test",
      model: "test-model",
      apiStyle: "completions",
      enableThinking: false,
    },
    action: "generate",
    mode: "agent",
    instruction: "How should I design an index?",
    context: {
      connectionId: "connection-1",
      connectionName: "Local",
      databaseType: "mysql",
      database: "",
      databases: [],
      databaseScope: "unscoped",
      currentSql: "",
      tables: [],
      sqlFiles: [],
      schemaScope: "none",
      truncated: false,
    },
  };
}

describe("unscoped AI streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the tool-free stream and forces ordinary Ask mode", async () => {
    mocks.aiStream.mockImplementation(async (_sessionId, request, onChunk) => {
      expect(request.taskContract).toMatchObject({ action: "general", mode: "ask" });
      onChunk({ session_id: "session-1", delta: "Use a selective index.", done: false });
      onChunk({ session_id: "session-1", delta: "", done: true });
    });
    const events: unknown[] = [];

    const result = await runAgentStream(unscopedInput(), [], (event) => events.push(event), "session-1");

    expect(result).toBe("Use a selective index.");
    expect(mocks.aiStream).toHaveBeenCalledOnce();
    expect(mocks.aiAgentStream).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "text_delta", delta: "Use a selective index." }, { type: "agent_end" }]);
  });

  it("does not load any metadata when no database is selected", async () => {
    const tab = {
      connectionId: "connection-1",
      database: "app",
      sql: "",
    } as QueryTab;
    const connection = {
      id: "connection-1",
      name: "Local",
      db_type: "mysql",
    } as ConnectionConfig;

    const context = await buildAiContext(tab, connection, { databaseScope: { mode: "unscoped" } });

    expect(context).toMatchObject({ database: "", databases: [], databaseScope: "unscoped", tables: [], schemaScope: "none" });
    expect(mocks.listTables).not.toHaveBeenCalled();
    expect(mocks.getColumns).not.toHaveBeenCalled();
    expect(mocks.listSchemas).not.toHaveBeenCalled();
    expect(mocks.listIndexes).not.toHaveBeenCalled();
    expect(mocks.listForeignKeys).not.toHaveBeenCalled();
  });
});
