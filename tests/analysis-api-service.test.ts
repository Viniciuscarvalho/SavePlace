import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../src/domain/models.js";
import { AnalysisApiService, type UserAnalysisRepository } from "../src/application/analysis-api-service.js";
import { AnalysisCache, type AnalysisCacheKey, type AnalysisCacheRepository, type AnalysisCacheWrite, type CachedAnalysis } from "../src/persistence/analysis-cache.js";
import { IdempotentOperation, requestHash, type IdempotencyClaim, type IdempotencyRepository, type IdempotencyRequest, type StoredIdempotencyResponse } from "../src/persistence/idempotency.js";

const analysisId = "00000000-0000-4000-8000-000000000001";

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
    const stored = { analysisId, sourceId: "source-1", result: write.result, verifiedPlaceReferences: [] };
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

class UserAnalysisRepositoryMemory implements UserAnalysisRepository {
  readonly links = new Set<string>();
  constructor(private readonly cache: CacheRepository) {}

  async linkUserToAnalysis(userId: string, analysisId: string): Promise<void> {
    this.links.add(`${userId}:${analysisId}`);
  }

  async findAnalysisForUser(userId: string, analysisId: string): Promise<CachedAnalysis | undefined> {
    if (!this.links.has(`${userId}:${analysisId}`)) return undefined;
    return [...this.cache.entries.values()].find((analysis) => analysis.analysisId === analysisId);
  }
}

describe("AnalysisApiService", () => {
  it("replays an idempotent request and uses the URL cache for a new key", async () => {
    const analyzer = { execute: vi.fn().mockResolvedValue(result) };
    const cacheRepository = new CacheRepository();
    const userAnalyses = new UserAnalysisRepositoryMemory(cacheRepository);
    const idempotencyRepository = new IdempotencyRepositoryMemory();
    const service = new AnalysisApiService({
      analyzer,
      cache: new AnalysisCache(cacheRepository),
      idempotency: new IdempotentOperation(idempotencyRepository),
      userAnalyses,
      pipelineVersion: "pipeline-v1",
      providerConfigFingerprint: "providers-v1",
    });

    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "miss" } });
    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: true, status: 200, body: { cache: "miss" } });
    await expect(service.analyze("user-a", "https://vt.tiktok.com/example/", "second")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "hit" } });
    await expect(service.analyze("user-b", "https://vt.tiktok.com/example/", "first")).resolves.toMatchObject({ replayed: false, status: 200, body: { cache: "hit" } });

    await expect(service.get("user-a", analysisId)).resolves.toMatchObject({ status: 200, body: { analysisId } });
    await expect(service.get("user-b", analysisId)).resolves.toMatchObject({ status: 200, body: { analysisId } });
    await expect(service.get("user-c", analysisId)).resolves.toBeUndefined();

    idempotencyRepository.entries.set(`user-c:legacy`, {
      requestHash: requestHash({ inputUrl: "https://vt.tiktok.com/example/" }),
      state: "completed",
      response: { responseStatus: 200, responseBody: { analysisId } },
    });
    await expect(service.analyze("user-c", "https://vt.tiktok.com/example/", "legacy")).resolves.toMatchObject({ replayed: true, status: 200 });
    await expect(service.get("user-c", analysisId)).resolves.toMatchObject({ status: 200, body: { analysisId } });

    expect(analyzer.execute).toHaveBeenCalledTimes(1);
    expect(userAnalyses.links).toEqual(new Set([`user-a:${analysisId}`, `user-b:${analysisId}`, `user-c:${analysisId}`]));
  });
});
