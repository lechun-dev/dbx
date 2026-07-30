export type AiDataDictionaryRefreshHours = 0 | 2 | 6 | 12 | 24;

export const AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS: AiDataDictionaryRefreshHours = 6;

const REFRESH_HOUR_VALUES = new Set<number>([0, 2, 6, 12, 24]);

export function normalizeAiDataDictionaryRefreshHours(value: unknown): AiDataDictionaryRefreshHours {
  return typeof value === "number" && REFRESH_HOUR_VALUES.has(value) ? (value as AiDataDictionaryRefreshHours) : AI_DATA_DICTIONARY_REFRESH_DEFAULT_HOURS;
}
