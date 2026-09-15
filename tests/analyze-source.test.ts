import { describe, expect, it } from "vitest";
import type { PlaceCandidate, SourceEvidence } from "../src/domain/models.js";
import type { AuditablePlaceExtractor, ExtractionRun } from "../src/extraction/place-extractor.js";
import { ContentSourceRouter, type ContentSource } from "../src/ingestion/content-source.js";
import { AnalyzeSource } from "../src/pipeline/analyze-source.js";
import { PlaceResolver, type PlaceMatch, type PlaceProvider } from "../src/resolution/place-resolver.js";

const source: SourceEvidence = {
  input: "https://vt.tiktok.com/example/",
  canonicalUrl: "https://www.tiktok.com/@creator/video/123",
  platform: "tiktok",
  evidence: [{ type: "description", text: "Madre em São Paulo" }],
};

const candidate: PlaceCandidate = {
  rawName: "Madre",
  category: "FOOD",
  cityHint: "São Paulo",
  extractionConfidence: 0.96,
  evidence: source.evidence,
};

const trace: ExtractionRun = {
  status: "completed",
  candidates: [candidate],
  attribution: {
    provider: "openai", model: "gpt-5.6-luna", promptVersion: "m0.3-url-evidence-v1",
    durationMs: 25, inputTokens: 100, outputTokens: 20, estimatedCostUsd: 0.000044,
  },
};

const contentSource: ContentSource = {
  canHandle: () => true,
  acquire: async () => ({ status: "acquired", source }),
};

const extractor: AuditablePlaceExtractor = {
  extract: async () => trace.candidates,
  extractWithTrace: async () => trace,
};

const match: PlaceMatch = {
  name: "Madre", normalizedName: "madre", address: "São Paulo, Brasil", city: "São Paulo", country: "Brasil",
  latitude: -23.5, longitude: -46.6, provider: "test", providerPlaceId: "id", resolutionConfidence: 0.96, verified: true,
};

const provider: PlaceProvider = { name: "test", search: async () => [match] };

describe("AnalyzeSource", () => {
  it("propagates LLM attribution while only a place provider verifies the resolved place", async () => {
    const pipeline = new AnalyzeSource(new ContentSourceRouter([contentSource]), extractor, new PlaceResolver(provider));

    const result = await pipeline.execute(source.input);

    expect(result.status).toBe("completed");
    expect(result.places).toHaveLength(1);
    expect(result.places[0]).toMatchObject({ verified: true, provider: "test", extractionConfidence: 0.96 });
    expect(result.processing.extraction).toEqual({ status: "completed", ...trace.attribution });
  });
});
