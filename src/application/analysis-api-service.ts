import type { AnalysisResult } from "../domain/models.js";
import { AnalysisCache, type AnalysisCacheResult } from "../persistence/analysis-cache.js";
import { IdempotentOperation, requestHash } from "../persistence/idempotency.js";

export interface AnalysisExecutor {
  execute(input: string): Promise<AnalysisResult>;
}

export type AnalysisApiResponse = {
  replayed: boolean;
  status: number;
  body: Record<string, unknown>;
};

export class AnalysisApiService {
  constructor(
    private readonly options: {
      analyzer: AnalysisExecutor;
      cache: AnalysisCache;
      idempotency: IdempotentOperation;
      ownerUserId: string;
      pipelineVersion: string;
      providerConfigFingerprint: string;
      idempotencyTtlMs?: number;
    },
  ) {}

  async analyze(inputUrl: string, idempotencyKey: string): Promise<AnalysisApiResponse> {
    const request = {
      userId: this.options.ownerUserId,
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
      return toResponse(cached);
    });

    if (execution.replayed) {
      return { replayed: true, status: execution.response.responseStatus, body: execution.response.responseBody };
    }
    return { replayed: false, status: execution.response.status, body: execution.response.body };
  }
}

function toResponse(cached: AnalysisCacheResult): { status: number; body: Record<string, unknown> } {
  if (cached.cache === "skipped") return { status: 422, body: { cache: "skipped", result: cached.result } };
  return {
    status: 200,
    body: {
      cache: cached.cache,
      analysisId: cached.analysis.analysisId,
      sourceId: cached.analysis.sourceId,
      result: cached.analysis.result,
    },
  };
}
