import type { AnalysisResult } from "../domain/models.js";
import { z } from "zod";
import { AnalysisCache, type AnalysisCacheResult, type CachedAnalysis } from "../persistence/analysis-cache.js";
import { IdempotentOperation, requestHash } from "../persistence/idempotency.js";

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
    const execution = await this.options.idempotency.execute(request, async () => {
      const cached = await this.options.cache.getOrCompute({
        inputUrl,
        pipelineVersion: this.options.pipelineVersion,
        providerConfigFingerprint: this.options.providerConfigFingerprint,
      }, () => this.options.analyzer.execute(inputUrl));
      if (cached.cache !== "skipped") {
        await this.options.userAnalyses.linkUserToAnalysis(userId, cached.analysis.analysisId);
      }
      return toResponse(cached);
    });

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
