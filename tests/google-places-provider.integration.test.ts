import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "../src/domain/models.js";
import { GooglePlacesProvider } from "../src/resolution/google-places-provider.js";

const apiKey = process.env.GOOGLE_MAPS_API_KEY;
const runLive = process.env.RUN_GOOGLE_PLACES_INTEGRATION === "1" && Boolean(apiKey);

const madreCandidate: PlaceCandidate = {
  rawName: "Madre",
  category: "FOOD",
  cityHint: "São Paulo",
  countryHint: "Brasil",
  extractionConfidence: 0.96,
  evidence: [{ type: "description", text: "Madre em Pinheiros, São Paulo." }],
};

describe("GooglePlacesProvider live integration", () => {
  it.runIf(runLive)("verifies the M0 acceptance candidate without requesting non-essential place data", async () => {
    const provider = new GooglePlacesProvider({ apiKey: apiKey!, monthlyRequestLimit: 1 });
    const matches = await provider.search(madreCandidate);

    expect(matches[0]).toMatchObject({
      provider: "google_places_new",
      verified: true,
      name: expect.stringMatching(/madre/i),
      city: "São Paulo",
      country: "Brasil",
    });
    expect(matches[0]?.resolutionConfidence).toBeGreaterThanOrEqual(0.85);
  });
});
