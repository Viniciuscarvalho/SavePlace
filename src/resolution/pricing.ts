import type { ProviderUsage } from "../domain/models.js";

/**
 * Provider billing is configuration, not business logic. M0 deliberately
 * refuses to infer a price from an SDK response or to silently report $0.
 */
export type ProviderPricing = {
  provider: string;
  operation: string;
  pricePerUnitUsd: number | null;
  source?: string;
  effectiveDate?: string;
};

export type { ProviderUsage } from "../domain/models.js";

export function usageFor(pricing: ProviderPricing | undefined, input: {
  provider: string;
  operation: string;
  requests: number;
  billableUnits: number;
}): ProviderUsage {
  if (input.requests < 0 || input.billableUnits < 0) throw new Error("Usage counts must be non-negative.");
  if (pricing && (pricing.provider !== input.provider || pricing.operation !== input.operation)) {
    throw new Error("Provider pricing must match the provider operation.");
  }

  const pricePerUnitUsd = pricing?.pricePerUnitUsd ?? null;
  if (pricePerUnitUsd !== null && (!Number.isFinite(pricePerUnitUsd) || pricePerUnitUsd < 0)) {
    throw new Error("Provider pricePerUnitUsd must be a non-negative finite number or null.");
  }

  if (pricePerUnitUsd === null) {
    return {
      ...input,
      estimatedCostUsd: null,
      costStatus: "pricing_not_configured",
    };
  }

  return {
    ...input,
    estimatedCostUsd: input.billableUnits * pricePerUnitUsd,
    costStatus: "estimated",
    ...(pricing?.source ? { pricingSource: pricing.source } : {}),
    ...(pricing?.effectiveDate ? { pricingEffectiveDate: pricing.effectiveDate } : {}),
  };
}
