<script setup lang="ts">
import { Filter, Plus, X } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import DataGridFilterBuilder from "@/components/grid/DataGridFilterBuilder.vue";
import type { DataGridStructuredFilterRule } from "@/composables/useDataGridFilterBuilder";
import type { DataGridContextFilterMode } from "@/lib/dataGrid/dataGridSql";

type LocalFilterSummary = {
  columnIndex: number;
  columnName: string;
  values: string[];
  hiddenValueCount: number;
};

const props = defineProps<{
  columns: readonly string[];
  canUseWhereSearch: boolean;
  leadingBorder: boolean;
  filterBuilderOpen: boolean;
  filterButtonActive: boolean;
  filterButtonCount: number;
  hasLocalColumnFilters: boolean;
  localFilterCount: number;
  localFilterSummaries: LocalFilterSummary[];
  rules: DataGridStructuredFilterRule[];
  filteredColumns: string[];
  modeOptions: Array<{ value: DataGridContextFilterMode; labelKey: string }>;
  columnSearch: string;
}>();

const emit = defineEmits<{
  "update:filterBuilderOpen": [value: boolean];
  "update:columnSearch": [value: string];
  ensureRule: [];
  addRule: [];
  applyFilters: [];
  resetFilters: [];
  clearFilters: [];
  removeRule: [id: string];
  updateRule: [id: string, patch: Partial<DataGridStructuredFilterRule>];
  clearLocalFilter: [columnIndex?: number];
}>();

const { t } = useI18n();

function updateRule(id: string, patch: Partial<DataGridStructuredFilterRule>) {
  emit("updateRule", id, patch);
}
</script>

<template>
  <!-- 2026-07-31 coder(lq): SQL 编辑器已覆盖自由条件输入，工具栏仅保留更直观的可视化筛选入口。 -->
  <div class="flex shrink-0 items-center border-r px-2 py-0.5" :class="{ 'border-l': leadingBorder }">
    <Popover :open="filterBuilderOpen" @update:open="emit('update:filterBuilderOpen', $event)">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="relative flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-medium transition-colors"
          :class="filterButtonActive ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15' : 'border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground'"
          :disabled="!canUseWhereSearch"
          @click="emit('ensureRule')"
        >
          <Filter class="h-3 w-3" />
          <span v-if="filterButtonCount" class="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] leading-none text-primary-foreground">{{ filterButtonCount }}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-[480px] max-w-[calc(100vw-24px)] gap-3 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="text-xs font-medium text-foreground">{{ t("grid.filter") }}</div>
          <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="emit('addRule')"><Plus class="mr-1 h-3.5 w-3.5" />{{ t("grid.filterBuilderAddRule") }}</Button>
        </div>

        <div v-if="hasLocalColumnFilters" class="space-y-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2 text-xs font-medium text-primary">
              <Filter class="h-3.5 w-3.5 shrink-0" /><span class="truncate">{{ t("grid.localFiltersActive", { count: localFilterCount }) }}</span>
            </div>
            <Button variant="ghost" size="sm" class="h-7 shrink-0 px-2 text-xs" @click="emit('clearLocalFilter')"><X class="mr-1 h-3.5 w-3.5" />{{ t("grid.clearLocalFiltersShort") }}</Button>
          </div>
          <div class="space-y-1">
            <div v-for="summary in localFilterSummaries" :key="summary.columnIndex" class="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)_auto] items-center gap-2 rounded border border-primary/10 bg-background/70 px-2 py-1 text-xs">
              <span class="truncate font-medium text-foreground" :title="summary.columnName">{{ summary.columnName }}</span>
              <span class="min-w-0 truncate font-mono text-muted-foreground">
                <template v-for="(value, valueIndex) in summary.values" :key="valueIndex"
                  ><span v-if="valueIndex > 0">, </span><span>{{ value }}</span></template
                >
                <span v-if="summary.hiddenValueCount">{{ t("grid.localFilterMoreValues", { count: summary.hiddenValueCount }) }}</span>
              </span>
              <Button variant="ghost" size="icon" class="h-6 w-6 text-muted-foreground hover:text-destructive" :title="t('grid.clearFilter')" @click="emit('clearLocalFilter', summary.columnIndex)"><X class="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>

        <DataGridFilterBuilder
          :rules="rules"
          :columns="[...columns]"
          :filtered-columns="filteredColumns"
          :mode-options="modeOptions"
          :column-search="columnSearch"
          :disabled="!canUseWhereSearch"
          :show-header="false"
          @add="emit('addRule')"
          @apply="emit('applyFilters')"
          @reset="emit('resetFilters')"
          @clear="emit('clearFilters')"
          @remove="emit('removeRule', $event)"
          @update-rule="updateRule"
          @update:column-search="emit('update:columnSearch', $event)"
        />
      </PopoverContent>
    </Popover>
  </div>
</template>
