import { describe, expect, it } from "vitest";
import { googleTextSearchPricingFromEnvironment } from "../src/resolution/google-places-pricing.js";

const baseline = {
  GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD: "0.032",
  GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE: "Google Maps Platform billing contract",
  GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE: "2026-09-28",
};

describe("googleTextSearchPricingFromEnvironment", () => {
  it("keeps unknown pricing unconfigured instead of inventing a cost", () => {
    expect(googleTextSearchPricingFromEnvironment({})).toBeUndefined();
  });

  it("returns an attributable Google Text Search pricing baseline", () => {
    expect(googleTextSearchPricingFromEnvironment(baseline)).toEqual({
      provider: "google_places_new",
      operation: "text_search",
      pricePerUnitUsd: 0.032,
      source: "Google Maps Platform billing contract",
      effectiveDate: "2026-09-28",
    });
  });

  it("rejects partial or malformed configured baselines", () => {
    expect(() => googleTextSearchPricingFromEnvironment({
      GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD: "0.032",
    })).toThrow("GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE must be set");
    expect(() => googleTextSearchPricingFromEnvironment({
      ...baseline,
      GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE: "28/09/2026",
    })).toThrow("GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE must be an ISO date");
  });
});
