import { describe, expect, it } from "vitest";
import type { PlaceCandidate, SourceEvidence } from "../src/domain/models.js";
import type { AuditablePlaceExtractor, ExtractionRun } from "../src/extraction/place-extractor.js";
import { ContentSourceRouter, type ContentSource } from "../src/ingestion/content-source.js";
import { AnalyzeSource, deduplicateResolvedPlaces } from "../src/pipeline/analyze-source.js";
import { PlaceResolver, type PlaceMatch, type PlaceProvider } from "../src/resolution/place-resolver.js";
import type { CandidateEvidenceJudge } from "../src/evidence/typesafe-evidence-judge.js";

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
    expect(result.mentions).toEqual([{ candidate, place: result.places[0] }]);
    expect(result.processing.extraction).toEqual({ status: "completed", ...trace.attribution });
  });

  it("keeps provider verification unchanged when evidence support does not support a candidate", async () => {
    const evidenceJudge: CandidateEvidenceJudge = {
      judge: async () => ({
        support: [{ candidateIndex: 0, status: "does_not_support", confidence: 0.99, probabilities: { supports: 0, ambiguous: 0.01, does_not_support: 0.99 } }],
        attribution: { status: "completed", provider: "typesafe", model: "fake", promptVersion: "test", durationMs: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
      }),
    };
    const pipeline = new AnalyzeSource(new ContentSourceRouter([contentSource]), extractor, new PlaceResolver(provider), evidenceJudge);

    const result = await pipeline.execute(source.input);

    expect(result).toMatchObject({
      status: "completed",
      places: [{ verified: true, provider: "test" }],
      candidateEvidenceSupport: [{ status: "does_not_support" }],
      processing: { evidenceJudgment: { provider: "typesafe", status: "completed" } },
    });
  });

  it("deduplicates final places by provider identity while retaining the strongest confidence", () => {
    const lower = { ...match, extractionConfidence: 0.9, overallConfidence: 0.9 };
    const higher = { ...match, extractionConfidence: 0.97, overallConfidence: 0.95 };

    expect(deduplicateResolvedPlaces([lower, higher])).toEqual([higher]);
  });

  it("reports provider request count separately from a resolved-place count", async () => {
    const pipeline = new AnalyzeSource(new ContentSourceRouter([contentSource]), extractor, new PlaceResolver(provider));

    const result = await pipeline.execute(source.input);

    expect(result.processing.resolution).toEqual({ provider: "test", requestCount: 1, unpricedRequestCount: 1, usage: [] });
  });

  it("retains an unresolved candidate without inventing a provider place link", async () => {
    const pipeline = new AnalyzeSource(
      new ContentSourceRouter([contentSource]),
      extractor,
      new PlaceResolver({ name: "empty", search: async () => [] }),
    );

    await expect(pipeline.execute(source.input)).resolves.toMatchObject({
      status: "needs_review",
      mentions: [{ candidate }],
      places: [],
    });
  });

  it("completes duplicate candidates once they resolve to the same provider identity", async () => {
    const duplicateExtractor: AuditablePlaceExtractor = {
      extract: async () => [candidate, { ...candidate, extractionConfidence: 0.9 }],
      extractWithTrace: async () => ({ ...trace, candidates: [candidate, { ...candidate, extractionConfidence: 0.9 }] }),
    };
    const pipeline = new AnalyzeSource(new ContentSourceRouter([contentSource]), duplicateExtractor, new PlaceResolver(provider));

    const result = await pipeline.execute(source.input);

    expect(result.status).toBe("completed");
    expect(result.places).toHaveLength(1);
    expect(result.mentions).toHaveLength(2);
    expect(result.mentions?.every((mention) => mention.place?.providerPlaceId === "id")).toBe(true);
    expect(result.processing.resolution).toEqual({ provider: "test", requestCount: 2, unpricedRequestCount: 2, usage: [] });
  });
});
