import { describe, expect, it } from "vitest";
import type { AnalysisResult, PlaceCandidate, ResolvedPlace } from "../src/domain/models.js";
import {
  mentionsForPersistence,
  providerPlaceIdentity,
  verifiedPlacesForPersistence,
} from "../src/persistence/analysis-place-persistence.js";

const candidate: PlaceCandidate = {
  rawName: "Cafe Example",
  normalizedName: "cafe example",
  category: "FOOD",
  cityHint: "Sao Paulo",
  extractionConfidence: 0.82,
  evidence: [{ type: "description", text: "Cafe Example on Rua Teste." }],
};

const place: ResolvedPlace = {
  name: "Cafe Example",
  normalizedName: "cafe example",
  category: "FOOD",
  address: "Rua Teste, 1",
  city: "Sao Paulo",
  country: "BR",
  latitude: -23.55052,
  longitude: -46.633308,
  provider: "google_places",
  providerPlaceId: "provider-place-1",
  extractionConfidence: 0.82,
  resolutionConfidence: 0.94,
  overallConfidence: 0.88,
  verified: true,
};

function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    status: "completed",
    source: { input: "https://vt.tiktok.com/example/", platform: "tiktok", canonicalUrl: "https://www.tiktok.com/@creator/video/1" },
    evidence: candidate.evidence,
    candidates: [candidate],
    places: [place],
    processing: { extractionMethod: "url_metadata", durationMs: 5 },
    ...overrides,
  };
}

describe("analysis place persistence", () => {
  it("keeps the exact candidate-to-verified-place link and all candidate evidence", () => {
    const mentions = mentionsForPersistence(result({ mentions: [{ candidate, place }] }));

    expect(mentions).toEqual([{ candidate, evidence: candidate.evidence, place }]);
    expect(verifiedPlacesForPersistence(mentions)).toEqual([place]);
    expect(providerPlaceIdentity(place)).toBe("google_places:provider-place-1");
  });

  it("does not infer a link from legacy candidates and the flattened places list", () => {
    const legacy = result();
    const mentions = mentionsForPersistence(legacy);

    expect(mentions).toEqual([{ candidate, evidence: candidate.evidence }]);
    expect(verifiedPlacesForPersistence(mentions)).toEqual([]);
  });

  it("deduplicates provider identities before persistence using the strongest result", () => {
    const stronger: ResolvedPlace = { ...place, overallConfidence: 0.95 };
    const mentions = mentionsForPersistence(result({
      candidates: [candidate, { ...candidate, rawName: "Cafe Example - duplicate" }],
      mentions: [
        { candidate, place },
        { candidate: { ...candidate, rawName: "Cafe Example - duplicate" }, place: stronger },
      ],
    }));

    expect(verifiedPlacesForPersistence(mentions)).toEqual([stronger]);
  });

  it("refuses a malformed unverified place at the persistence boundary", () => {
    const unverified = { ...place, verified: false } as unknown as ResolvedPlace;
    const mentions = mentionsForPersistence(result({ mentions: [{ candidate, place: unverified }] }));

    expect(mentions).toEqual([{ candidate, evidence: candidate.evidence }]);
  });
});
