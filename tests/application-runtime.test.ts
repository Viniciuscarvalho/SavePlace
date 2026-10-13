import { afterEach, describe, expect, it, vi } from "vitest";
import { createApplicationRuntime } from "../src/application/application-runtime.js";

const googlePlace = {
  places: [{
    id: "google-place-id",
    displayName: { text: "Madre" },
    formattedAddress: "R. Vupabussu, 109 - Pinheiros, São Paulo - SP, Brasil",
    location: { latitude: -23.564, longitude: -46.691 },
    addressComponents: [
      { longText: "São Paulo", types: ["locality", "political"] },
      { longText: "São Paulo", types: ["administrative_area_level_1", "political"] },
      { longText: "Brasil", types: ["country", "political"] },
    ],
  }],
};

afterEach(() => vi.unstubAllGlobals());

describe("createApplicationRuntime", () => {
  it("passes the configured Google pricing baseline into a persisted-analysis pipeline", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://www.tiktok.com/oembed")) {
        return new Response(JSON.stringify({
          type: "video",
          title: "Madre em São Paulo, Brasil",
          author_name: "SavePlace",
          html: '<blockquote cite="https://www.tiktok.com/@saveplace/video/1234567890"></blockquote>',
          provider_name: "TikTok",
        }));
      }
      if (url === "https://api.openai.com/v1/responses") {
        return new Response(JSON.stringify({
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
            candidates: [{
              rawName: "Madre",
              entityKind: "venue",
              normalizedName: null,
              category: "FOOD",
              subcategory: null,
              cityHint: "São Paulo",
              neighborhoodHint: null,
              countryHint: "Brasil",
              extractionConfidence: 0.9,
              evidenceIndices: [0],
            }],
          }) }] }],
          usage: { input_tokens: 100, output_tokens: 10 },
        }));
      }
      if (url === "https://places.googleapis.com/v1/places:searchText") {
        return new Response(JSON.stringify(googlePlace));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const runtime = createApplicationRuntime({
      OPENAI_API_KEY: "openai-test-key",
      GOOGLE_MAPS_API_KEY: "google-test-key",
      GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD: "0.032",
      GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE: "Google Maps Platform billing contract",
      GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE: "2026-09-28",
    });

    const result = await runtime.analyzer.execute("https://vt.tiktok.com/ZSq4UprxR/");

    expect(result.processing.resolution).toMatchObject({
      provider: "google_places_new",
      requestCount: 1,
      estimatedCostUsd: 0.032,
      unpricedRequestCount: 0,
      usage: [expect.objectContaining({
        estimatedCostUsd: 0.032,
        costStatus: "estimated",
        pricingSource: "Google Maps Platform billing contract",
        pricingEffectiveDate: "2026-09-28",
      })],
    });
  });
});
