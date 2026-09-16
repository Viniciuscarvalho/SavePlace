import { describe, expect, it, vi } from "vitest";
import type { PlaceCandidate } from "../src/domain/models.js";
import { GooglePlacesProvider, InMemoryUsageLedger } from "../src/resolution/google-places-provider.js";

const candidate: PlaceCandidate = {
  rawName: "Madre",
  category: "FOOD",
  cityHint: "São Paulo",
  countryHint: "Brasil",
  extractionConfidence: 0.96,
  evidence: [{ type: "description", text: "Madre em Pinheiros, São Paulo." }],
};

const googlePlace = {
  places: [{
    id: "google-place-id",
    displayName: { text: "Madre" },
    formattedAddress: "R. Vupabussu, 109 - Pinheiros, São Paulo - SP, Brasil",
    location: { latitude: -23.564, longitude: -46.691 },
    addressComponents: [
      { longText: "São Paulo", shortText: "São Paulo", types: ["locality", "political"] },
      { longText: "São Paulo", shortText: "SP", types: ["administrative_area_level_1", "political"] },
      { longText: "Brasil", shortText: "BR", types: ["country", "political"] },
    ],
  }],
};

describe("GooglePlacesProvider", () => {
  it("uses a minimal Text Search field mask and returns a verified provider match", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(googlePlace), { status: 200 }));
    const provider = new GooglePlacesProvider({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });

    const matches = await provider.search(candidate);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(init).toMatchObject({ method: "POST" });
    expect((init.headers as Record<string, string>)["x-goog-fieldmask"])
      .toBe("places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents");
    expect(JSON.parse(init.body as string)).toMatchObject({ textQuery: "Madre, São Paulo, Brasil", maxResultCount: 5 });
    expect(matches).toEqual([expect.objectContaining({
      name: "Madre", city: "São Paulo", country: "Brasil", provider: "google_places_new", providerPlaceId: "google-place-id", verified: true,
    })]);
    expect(matches[0]?.resolutionConfidence).toBeGreaterThanOrEqual(0.93);
  });

  it("fails closed when the provider response does not include a resolvable city and country", async () => {
    const incomplete = { places: [{ ...googlePlace.places[0], addressComponents: [] }] };
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(incomplete), { status: 200 }));
    const provider = new GooglePlacesProvider({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.search(candidate)).resolves.toEqual([]);
  });

  it("enforces the conservative M0 monthly cap before spending another request", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify(googlePlace), { status: 200 }));
    const provider = new GooglePlacesProvider({
      apiKey: "test-key",
      fetchFn: fetchFn as unknown as typeof fetch,
      usageLedger: new InMemoryUsageLedger(),
      monthlyRequestLimit: 1,
      now: () => new Date("2026-09-15T00:00:00.000Z"),
    });

    await expect(provider.search(candidate)).resolves.toHaveLength(1);
    await expect(provider.search(candidate)).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("records an optional local cost estimate only for a request that left the process", async () => {
    const provider = new GooglePlacesProvider({
      apiKey: "test-key",
      textSearchEstimatedCostUsd: 0.032,
      fetchFn: vi.fn().mockResolvedValue(new Response(JSON.stringify({ places: [] }), { status: 200 })) as unknown as typeof fetch,
    });

    await expect(provider.searchWithTrace(candidate)).resolves.toEqual({ matches: [], requestCount: 1, estimatedCostUsd: 0.032 });
  });

  it.each([
    ["a non-success response", vi.fn().mockResolvedValue(new Response("", { status: 429 }))],
    ["invalid JSON", vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))],
    ["a network failure", vi.fn().mockRejectedValue(new Error("network unavailable"))],
  ])("fails closed on %s", async (_scenario, fetchFn) => {
    const provider = new GooglePlacesProvider({ apiKey: "test-key", fetchFn: fetchFn as typeof fetch });
    await expect(provider.search(candidate)).resolves.toEqual([]);
  });
});
