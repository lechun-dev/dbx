import { describe, expect, it } from "vitest";
import { aiScopeAllowsAgentExecution, aiScopeAllowsExecution, aiScopeDatabases, aiScopeExecutionDatabase, normalizeAiDatabaseScope, parseAiDatabaseScope } from "@/lib/ai/aiDatabaseScope";

describe("AI database scope", () => {
  it("safely restores a persisted database scope", () => {
    expect(parseAiDatabaseScope({ mode: "selected", databases: ["sales", "crm"] })).toEqual({
      mode: "selected",
      databases: ["sales", "crm"],
    });
    expect(parseAiDatabaseScope({ mode: "selected", databases: "sales" })).toBeUndefined();
    expect(parseAiDatabaseScope({ mode: "selected", databases: ["sales", 1] })).toBeUndefined();
    expect(parseAiDatabaseScope({ mode: "unexpected" })).toBeUndefined();
  });

  it("uses the current database without duplicating scope state", () => {
    expect(aiScopeDatabases({ mode: "current" }, "app")).toEqual(["app"]);
  });

  it("normalizes selected databases and keeps them on one connection", () => {
    expect(normalizeAiDatabaseScope({ mode: "selected", databases: ["orders", " users ", "ORDERS"] }, "app")).toEqual({
      mode: "selected",
      databases: ["orders", "users"],
    });
  });

  it("does not allow SQL execution without a database", () => {
    expect(aiScopeAllowsExecution({ mode: "unscoped" }, "app")).toBe(false);
    expect(aiScopeAllowsExecution({ mode: "current" }, "")).toBe(false);
  });

  it("targets a selected single database but leaves multi-database SQL fully qualified", () => {
    expect(aiScopeExecutionDatabase({ mode: "selected", databases: ["reporting"] }, "app")).toBe("reporting");
    expect(aiScopeExecutionDatabase({ mode: "selected", databases: ["app", "reporting"] }, "app")).toBeUndefined();
  });

  it("allows MySQL multi-database agent execution but rejects PostgreSQL cross-database execution", () => {
    const scope = { mode: "selected", databases: ["orders", "users"] } as const;
    expect(aiScopeAllowsAgentExecution(scope, "orders", "mysql")).toBe(true);
    expect(aiScopeAllowsAgentExecution(scope, "orders", "postgres")).toBe(false);
  });
});
