import { describe, expect, it } from "vitest";
import { DATA_GRID_STRIPE_STRENGTH_DEFAULT, dataGridStripeBackground, normalizeDataGridStripeStrength } from "@/lib/dataGrid/dataGridStripe";

describe("data-grid stripe strength", () => {
  it("uses the softer default for missing and invalid values", () => {
    expect(normalizeDataGridStripeStrength(undefined)).toBe(DATA_GRID_STRIPE_STRENGTH_DEFAULT);
    expect(normalizeDataGridStripeStrength(Number.NaN)).toBe(DATA_GRID_STRIPE_STRENGTH_DEFAULT);
    expect(normalizeDataGridStripeStrength("8")).toBe(DATA_GRID_STRIPE_STRENGTH_DEFAULT);
  });

  it("rounds and clamps persisted values", () => {
    expect(normalizeDataGridStripeStrength(-1)).toBe(0);
    expect(normalizeDataGridStripeStrength(7.6)).toBe(8);
    expect(normalizeDataGridStripeStrength(99)).toBe(16);
  });

  it("turns striping off at zero and produces a theme-aware color otherwise", () => {
    expect(dataGridStripeBackground(0)).toBe("var(--background)");
    expect(dataGridStripeBackground(3)).toBe("color-mix(in srgb, var(--muted) 97%, var(--foreground))");
  });
});
