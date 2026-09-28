import type { ProviderPricing } from "./pricing.js";

const PRICE_VARIABLE = "GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD";
const SOURCE_VARIABLE = "GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE";
const EFFECTIVE_DATE_VARIABLE = "GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE";

type Environment = Readonly<Record<string, string | undefined>>;

function optionalEnvironment(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Reads the Google Text Search price from the active billing contract.
 * A partial baseline is rejected: a numeric price without its source and
 * effective date is not attributable enough for a product cost metric.
 */
export function googleTextSearchPricingFromEnvironment(environment: Environment): ProviderPricing | undefined {
  const rawPrice = optionalEnvironment(environment, PRICE_VARIABLE);
  if (!rawPrice) return undefined;

  const pricePerUnitUsd = Number(rawPrice);
  if (!Number.isFinite(pricePerUnitUsd) || pricePerUnitUsd < 0) {
    throw new Error(`${PRICE_VARIABLE} must be a non-negative number when set.`);
  }

  const source = optionalEnvironment(environment, SOURCE_VARIABLE);
  if (!source) throw new Error(`${SOURCE_VARIABLE} must be set when ${PRICE_VARIABLE} is set.`);

  const effectiveDate = optionalEnvironment(environment, EFFECTIVE_DATE_VARIABLE);
  if (!effectiveDate || !isIsoDate(effectiveDate)) {
    throw new Error(`${EFFECTIVE_DATE_VARIABLE} must be an ISO date (YYYY-MM-DD) when ${PRICE_VARIABLE} is set.`);
  }

  return {
    provider: "google_places_new",
    operation: "text_search",
    pricePerUnitUsd,
    source,
    effectiveDate,
  };
}
