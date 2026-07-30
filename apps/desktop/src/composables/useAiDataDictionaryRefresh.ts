import { onMounted, onUnmounted } from "vue";
import { refreshRegisteredAiDataDictionaries, type AiDataDictionaryRefreshSummary } from "@/lib/ai/dataDictionaryRefresh";
import { useConnectionStore } from "@/stores/connectionStore";
import { useSettingsStore } from "@/stores/settingsStore";

const SCHEDULER_CHECK_INTERVAL_MS = 60_000;
const APP_IDLE_THRESHOLD_MS = 60_000;

let lastUserActivityAt = Date.now();
let schedulerTimer: ReturnType<typeof window.setInterval> | undefined;
let schedulerUsers = 0;
let schedulerRunning = false;

function recordUserActivity() {
  lastUserActivityAt = Date.now();
}

export function useAiDataDictionaryRefresh(options: { scheduler?: boolean } = {}) {
  const connectionStore = useConnectionStore();
  const settingsStore = useSettingsStore();

  const connectionSource = {
    getConfig: (connectionId: string) => connectionStore.getConfig(connectionId),
    isConnected: (connectionId: string) => connectionStore.connectedIds.has(connectionId),
  };

  async function refreshNow(): Promise<AiDataDictionaryRefreshSummary> {
    return refreshRegisteredAiDataDictionaries({
      connectionSource,
      refreshHours: settingsStore.desktopSettings.ai_data_dictionary_refresh_hours,
      force: true,
    });
  }

  async function runScheduledRefresh() {
    if (schedulerRunning || Date.now() - lastUserActivityAt < APP_IDLE_THRESHOLD_MS) return;
    schedulerRunning = true;
    try {
      await refreshRegisteredAiDataDictionaries({
        connectionSource,
        refreshHours: settingsStore.desktopSettings.ai_data_dictionary_refresh_hours,
      });
    } finally {
      schedulerRunning = false;
    }
  }

  if (options.scheduler) {
    onMounted(() => {
      schedulerUsers += 1;
      if (schedulerUsers > 1) return;
      window.addEventListener("keydown", recordUserActivity, { passive: true });
      window.addEventListener("pointerdown", recordUserActivity, { passive: true });
      window.addEventListener("wheel", recordUserActivity, { passive: true });
      schedulerTimer = window.setInterval(() => void runScheduledRefresh(), SCHEDULER_CHECK_INTERVAL_MS);
    });
    onUnmounted(() => {
      schedulerUsers = Math.max(0, schedulerUsers - 1);
      if (schedulerUsers > 0) return;
      if (schedulerTimer) window.clearInterval(schedulerTimer);
      schedulerTimer = undefined;
      window.removeEventListener("keydown", recordUserActivity);
      window.removeEventListener("pointerdown", recordUserActivity);
      window.removeEventListener("wheel", recordUserActivity);
    });
  }

  return { refreshNow };
}
