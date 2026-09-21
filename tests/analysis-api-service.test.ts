import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../src/domain/models.js";
import { AnalysisApiService } from "../src/application/analysis-api-service.js";
import { AnalysisCache, type AnalysisCacheKey, type AnalysisCacheRepository, type AnalysisCacheWrite, type CachedAnalysis } from "../src/persistence/analysis-cache.js";
import { IdempotentOperation, type IdempotencyClaim, type IdempotencyRepository, type IdempotencyRequest, type StoredIdempotencyResponse } from "../src/persistence/idempotency.js";

const result: AnalysisResult = {
  status: "needs_review",
  source: {
    input: "https://vt.tiktok.com/example/",
    platform: "tiktok",
    canonicalUrl: "https://www.tiktok.com/@creator/video/123",
    contentId: "123",
  },
  evidence: [],
  candidates: [],
  places: [],
  processing: { extractionMethod: "url_metadata", durationMs: 1 },
  nextAction: "review",
};

class CacheRepository implements AnalysisCacheRepository {
  readonly entries = new Map<string, CachedAnalysis>();
  private key(key: AnalysisCacheKey): string {
    return `${key.inputUrl}:${key.pipelineVersion}:${key.providerConfigFingerprint}`;
  }

  async findCachedAnalysis(key: AnalysisCacheKey): Promise<CachedAnalysis | undefined> {
    return this.entries.get(this.key(key));
  }

  async storeAnalysis(write: AnalysisCacheWrite): Promise<CachedAnalysis> {
    const stored = { analysisId: "analysis-1", sourceId: "source-1", result: write.result, verifiedPlaceReferences: [] };
    this.entries.set(this.key(write), stored);
    return stored;
  }
}

class IdempotencyRepositoryMemory implements IdempotencyRepository {
  readonly entries = new Map<string, { requestHash: string; state: "processing" | "completed" | "failed"; response?: StoredIdempotencyResponse }>();
  private key(request: IdempotencyRequest): string {
    return `${request.userId}:${request.idempotencyKey}`;
  }

  async claim(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    const key = this.key(request);
    const entry = this.entries.get(key);
    if (!entry) {
      this.entries.set(key, { requestHash: request.requestHash, state: "processing" });
      return { state: "started", operationId: key };
    }
    if (entry.requestHash !== request.requestHash) return { state: "conflict", operationId: key };
    if (entry.state === "processing") return { state: "in_progress", operationId: key };
    return { state: "replay", operationId: key, response: entry.response! };
  }

  async complete(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> {
    this.entries.set(this.key(request), { requestHash: request.requestHash, state: "completed", response });
  }

  async fail(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> {
    this.entries.set(this.key(request), { requestHash: request.requestHash, state: "failed", response });
  }
}

describe("AnalysisApiService", () => {
  it("replays an idempotent request and uses the URL cache for a new key", async () => {
    const analyzer = { execute: vi.fn().mockResolvedValue(result) };
    const service = new AnalysisApiService({
      analyzer,
      cache: new AnalysisCache(new CacheRepository()),
      idempotency: new IdempotentOperation(new IdempotencyRepositoryMemory()),
      pipelineVersion: "pipeline-v1",
      providerConfigFingerprint: "providers-v1",
    });

    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "miss" } });
    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: true, status: 200, body: { cache: "miss" } });
    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "second")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "hit" } });
    await expect(service.analyze("user-b", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "hit" } });

    expect(analyzer.execute).toHaveBeenCalledTimes(1);
  });
});
