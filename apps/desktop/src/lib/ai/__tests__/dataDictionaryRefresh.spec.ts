import { describe, expect, it } from "vitest";
import type { AiDataDictionarySnapshot } from "@/lib/ai/dataDictionary";
import { AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS, aiDataDictionaryFailureBackoffMs, aiDataDictionaryRefreshIsDue, effectiveAiDataDictionaryRefreshHours, normalizeAiDataDictionaryRefreshHours } from "@/lib/ai/dataDictionaryRefresh";

function refreshSnapshot(overrides: Partial<AiDataDictionarySnapshot> = {}): AiDataDictionarySnapshot {
  return {
    version: 1,
    connectionId: "connection",
    connectionName: "Local",
    database: "app",
    databaseType: "mysql",
    updatedAt: 1_000,
    tables: [],
    ...overrides,
  };
}

describe("AI data dictionary scheduled refresh", () => {
  it("normalizes supported intervals and falls back to six hours", () => {
    for (const value of [0, 2, 6, 12, 24] as const) {
      expect(normalizeAiDataDictionaryRefreshHours(value)).toBe(value);
    }
    expect(normalizeAiDataDictionaryRefreshHours(3)).toBe(AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS);
    expect(normalizeAiDataDictionaryRefreshHours("2")).toBe(AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS);
  });

  it("enforces a twelve-hour production minimum without overriding off", () => {
    expect(effectiveAiDataDictionaryRefreshHours(0, true)).toBe(0);
    expect(effectiveAiDataDictionaryRefreshHours(2, true)).toBe(12);
    expect(effectiveAiDataDictionaryRefreshHours(6, true)).toBe(12);
    expect(effectiveAiDataDictionaryRefreshHours(24, true)).toBe(24);
    expect(effectiveAiDataDictionaryRefreshHours(2, false)).toBe(2);
  });

  it("becomes due at the configured interval and respects failure backoff", () => {
    const hour = 60 * 60 * 1_000;
    expect(aiDataDictionaryRefreshIsDue(refreshSnapshot(), 6, false, 1_000 + 6 * hour - 1)).toBe(false);
    expect(aiDataDictionaryRefreshIsDue(refreshSnapshot(), 6, false, 1_000 + 6 * hour)).toBe(true);
    expect(aiDataDictionaryRefreshIsDue(refreshSnapshot(), 0, false, Number.MAX_SAFE_INTEGER)).toBe(false);

    const failed = refreshSnapshot({
      lastReconciledAt: 1_000,
      lastRefreshErrorAt: 1_000 + 6 * hour,
      consecutiveRefreshFailures: 2,
    });
    expect(aiDataDictionaryRefreshIsDue(failed, 6, false, 1_000 + 6 * hour + 10 * 60 * 1_000 - 1)).toBe(false);
    expect(aiDataDictionaryRefreshIsDue(failed, 6, false, 1_000 + 6 * hour + 10 * 60 * 1_000)).toBe(true);
  });

  it("uses exponential failure backoff capped at one hour", () => {
    expect(aiDataDictionaryFailureBackoffMs(1)).toBe(5 * 60 * 1_000);
    expect(aiDataDictionaryFailureBackoffMs(2)).toBe(10 * 60 * 1_000);
    expect(aiDataDictionaryFailureBackoffMs(3)).toBe(20 * 60 * 1_000);
    expect(aiDataDictionaryFailureBackoffMs(10)).toBe(60 * 60 * 1_000);
  });
});
