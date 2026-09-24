import type { AnalysisResult } from "../domain/models.js";
import { z } from "zod";
import { AnalysisCache, type AnalysisCacheResult, type CachedAnalysis } from "../persistence/analysis-cache.js";
import { IdempotentOperation, requestHash } from "../persistence/idempotency.js";
import { AnalysisUsageService, UserAnalysisLimitExceededError } from "./analysis-usage-service.js";

export interface AnalysisExecutor {
  execute(input: string): Promise<AnalysisResult>;
}

const PersistedAnalysisIdSchema = z.object({ analysisId: z.string().uuid() });

export type AnalysisApiResponse = {
  replayed: boolean;
  status: number;
  body: Record<string, unknown>;
};

export type AnalysisReadResponse = {
  status: 200;
  body: Record<string, unknown>;
};

export interface UserAnalysisRepository {
  linkUserToAnalysis(userId: string, analysisId: string): Promise<void>;
  findAnalysisForUser(userId: string, analysisId: string): Promise<CachedAnalysis | undefined>;
}

export class AnalysisApiService {
  constructor(
    private readonly options: {
      analyzer: AnalysisExecutor;
      cache: AnalysisCache;
      idempotency: IdempotentOperation;
      userAnalyses: UserAnalysisRepository;
      pipelineVersion: string;
      providerConfigFingerprint: string;
      idempotencyTtlMs?: number;
      usage?: AnalysisUsageService;
    },
  ) {}

  async analyze(userId: string, inputUrl: string, idempotencyKey: string): Promise<AnalysisApiResponse> {
    requireUserId(userId);
    const request = {
      userId,
      idempotencyKey,
      requestHash: requestHash({ inputUrl }),
      expiresAt: new Date(Date.now() + (this.options.idempotencyTtlMs ?? 86_400_000)),
    };
    let cachedResult: AnalysisCacheResult | undefined;
    const startedAt = performance.now();
    let execution;
    try {
      execution = await this.options.idempotency.execute(request, async () => {
        cachedResult = await this.options.cache.getOrCompute({
          inputUrl,
          pipelineVersion: this.options.pipelineVersion,
          providerConfigFingerprint: this.options.providerConfigFingerprint,
        }, async () => {
          await this.options.usage?.consumeBeforePaidAnalysis(userId);
          return this.options.analyzer.execute(inputUrl);
        });
        if (cachedResult.cache !== "skipped") {
          await this.options.userAnalyses.linkUserToAnalysis(userId, cachedResult.analysis.analysisId);
        }
        return toResponse(cachedResult);
      });
    } catch (error) {
      if (error instanceof UserAnalysisLimitExceededError) {
        return { replayed: false, status: error.response.responseStatus, body: error.response.responseBody };
      }
      throw error;
    }

    if (!execution.replayed && cachedResult) {
      await this.recordUsage(cachedResult, performance.now() - startedAt);
    }

    if (execution.replayed) {
      const replayedAnalysis = PersistedAnalysisIdSchema.safeParse(execution.response.responseBody);
      if (replayedAnalysis.success) {
        await this.options.userAnalyses.linkUserToAnalysis(userId, replayedAnalysis.data.analysisId);
      }
      return { replayed: true, status: execution.response.responseStatus, body: execution.response.responseBody };
    }
    return { replayed: false, status: execution.response.status, body: execution.response.body };
  }

  async get(userId: string, analysisId: string): Promise<AnalysisReadResponse | undefined> {
    requireUserId(userId);
    const analysis = await this.options.userAnalyses.findAnalysisForUser(userId, analysisId);
    return analysis ? { status: 200, body: persistedResponse(analysis) } : undefined;
  }

  private async recordUsage(cached: AnalysisCacheResult, durationMs: number): Promise<void> {
    if (!this.options.usage) return;
    const result = cached.cache === "skipped" ? cached.result : cached.analysis.result;
    const resolution = result.processing.resolution;
    const usage = resolution?.usage ?? [];
    const extraction = result.processing.extraction;
    const judgment = result.processing.evidenceJudgment;
    const costs = [
      ...usage.map((item) => item.estimatedCostUsd),
      ...(extraction?.status === "completed" ? [extraction.estimatedCostUsd] : []),
      ...(judgment?.status === "completed" ? [judgment.estimatedCostUsd] : []),
    ];
    try {
      await this.options.usage.record({
        cache: cached.cache,
        durationMs,
        estimatedCostUsd: resolution?.unpricedRequestCount || costs.some((cost) => cost === null)
          ? null
          : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0),
      });
    } catch {
      // Metrics must not turn an already completed analysis into a client failure.
    }
  }
}

function toResponse(cached: AnalysisCacheResult): { status: number; body: Record<string, unknown> } {
  if (cached.cache === "skipped") return { status: 422, body: { cache: "skipped", result: cached.result } };
  return {
    status: 200,
    body: {
      cache: cached.cache,
      ...persistedResponse(cached.analysis),
    },
  };
}

function persistedResponse(analysis: CachedAnalysis): Record<string, unknown> {
  return {
    analysisId: analysis.analysisId,
    sourceId: analysis.sourceId,
    verifiedPlaceReferences: analysis.verifiedPlaceReferences,
    result: analysis.result,
  };
}

function requireUserId(userId: string): void {
  if (!userId.trim() || userId.length > 128) throw new Error("userId must be 1-128 characters.");
}
