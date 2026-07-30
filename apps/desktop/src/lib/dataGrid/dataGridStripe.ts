export const DATA_GRID_STRIPE_STRENGTH_MIN = 0;
export const DATA_GRID_STRIPE_STRENGTH_MAX = 16;
export const DATA_GRID_STRIPE_STRENGTH_DEFAULT = 3;

export function normalizeDataGridStripeStrength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DATA_GRID_STRIPE_STRENGTH_DEFAULT;
  return Math.min(DATA_GRID_STRIPE_STRENGTH_MAX, Math.max(DATA_GRID_STRIPE_STRENGTH_MIN, Math.round(value)));
}

export function dataGridStripeBackground(strength: unknown): string {
  const normalized = normalizeDataGridStripeStrength(strength);
  if (normalized === 0) return "var(--background)";
  return `color-mix(in srgb, var(--muted) ${100 - normalized}%, var(--foreground))`;
}
