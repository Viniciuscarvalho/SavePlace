import { describe, expect, it } from "vitest";
import type { PlaceCandidate } from "../src/domain/models.js";
import { PlaceResolver, type PlaceMatch, type PlaceProvider } from "../src/resolution/place-resolver.js";

const candidate: PlaceCandidate = {
  rawName: "@bar.sororoca",
  normalizedName: "bar sororoca",
  category: "FOOD",
  extractionConfidence: 0.75,
  evidence: [{ type: "description", text: "@bar.sororoca em Pinheiros" }],
};

const match: PlaceMatch = {
  name: "Sororoca Bar",
  normalizedName: "sororoca bar",
  address: "São Paulo, Brasil",
  city: "São Paulo",
  country: "Brasil",
  latitude: -23.55,
  longitude: -46.68,
  provider: "google_places_new",
  providerPlaceId: "known-provider-id",
  resolutionConfidence: 0.88,
  verified: true,
};

describe("PlaceResolver", () => {
  it("accepts a strong provider identity when social evidence is intentionally conservative", async () => {
    const provider: PlaceProvider = { name: "google_places_new", search: async () => [match] };

    await expect(new PlaceResolver(provider).resolve(candidate)).resolves.toEqual(expect.objectContaining({
      providerPlaceId: "known-provider-id",
      verified: true,
      overallConfidence: expect.closeTo(Math.sqrt(0.75 * 0.88), 12),
    }));
  });

  it("keeps a weak provider match out even when the LLM is confident", async () => {
    const provider: PlaceProvider = { name: "google_places_new", search: async () => [{ ...match, resolutionConfidence: 0.84 }] };

    await expect(new PlaceResolver(provider).resolve({ ...candidate, extractionConfidence: 0.99 })).resolves.toBeNull();
  });
});
