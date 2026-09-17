import { describe, expect, it, vi } from "vitest";
import { AnalysisCache, cacheableSource, normalizeSubmittedUrl, providerUsageFromAnalysis, type AnalysisCacheRepository } from "../src/persistence/analysis-cache.js";
import type { AnalysisResult } from "../src/domain/models.js";

const result: AnalysisResult = {
  status: "completed",
  source: { input: "https://vt.tiktok.com/short/", platform: "tiktok", canonicalUrl: "https://www.tiktok.com/@creator/video/123", contentId: "123" },
  evidence: [], candidates: [], places: [],
  processing: {
    extractionMethod: "url_metadata",
    durationMs: 10,
    extraction: { status: "completed", provider: "openai", model: "model", promptVersion: "v1", durationMs: 4, inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 },
  },
};

class MemoryCacheRepository implements AnalysisCacheRepository {
  readonly entries = new Map<string, { analysisId: string; sourceId: string; result: AnalysisResult }>();

  async findCachedAnalysis(key: { inputUrl: string; pipelineVersion: string; providerConfigFingerprint: string }) {
    return this.entries.get(JSON.stringify(key));
  }

  async storeAnalysis(write: { inputUrl: string; pipelineVersion: string; providerConfigFingerprint: string; result: AnalysisResult }) {
    const analysis = { analysisId: "analysis-1", sourceId: "source-1", result: write.result };
    this.entries.set(JSON.stringify({ inputUrl: write.inputUrl, pipelineVersion: write.pipelineVersion, providerConfigFingerprint: write.providerConfigFingerprint }), analysis);
    return analysis;
  }
}

describe("AnalysisCache", () => {
  it("does not repeat a paid pipeline for the same submitted URL and configuration", async () => {
    const repository = new MemoryCacheRepository();
    const cache = new AnalysisCache(repository);
    const compute = vi.fn().mockResolvedValue(result);
    const key = { inputUrl: result.source.input, pipelineVersion: "m1", providerConfigFingerprint: "providers-v1" };

    await expect(cache.getOrCompute(key, compute)).resolves.toMatchObject({ cache: "miss" });
    await expect(cache.getOrCompute(key, compute)).resolves.toMatchObject({ cache: "hit" });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache when the executable provider configuration changes", async () => {
    const repository = new MemoryCacheRepository();
    const cache = new AnalysisCache(repository);
    const compute = vi.fn().mockResolvedValue(result);

    await cache.getOrCompute({ inputUrl: result.source.input, pipelineVersion: "m1", providerConfigFingerprint: "model-a" }, compute);
    await cache.getOrCompute({ inputUrl: result.source.input, pipelineVersion: "m1", providerConfigFingerprint: "model-b" }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("normalizes HTTPS aliases and retains only provider-attributed usage", () => {
    expect(normalizeSubmittedUrl("https://VT.TIKTOK.COM/short/#fragment")).toBe("https://vt.tiktok.com/short/");
    expect(normalizeSubmittedUrl("http://vt.tiktok.com/short/")).toBeUndefined();
    expect(cacheableSource(result, result.source.input)).toMatchObject({ platform: "tiktok", canonicalContentId: "123" });
    expect(providerUsageFromAnalysis(result)).toEqual([{
      provider: "openai", operation: "place_extraction", requests: 1, billableUnits: 15, estimatedCostUsd: 0.01, costStatus: "estimated",
    }]);
  });

  it("does not persist unsupported input as a cache entry", async () => {
    const repository = new MemoryCacheRepository();
    const cache = new AnalysisCache(repository);
    const unsupported: AnalysisResult = {
      ...result,
      status: "failed",
      source: { input: "not-a-url", platform: "unknown" },
    };

    await expect(cache.getOrCompute({ inputUrl: "https://vt.tiktok.com/short/", pipelineVersion: "m1", providerConfigFingerprint: "providers-v1" }, async () => unsupported))
      .resolves.toMatchObject({ cache: "skipped", result: unsupported });
    expect(repository.entries).toHaveLength(0);
  });
});
