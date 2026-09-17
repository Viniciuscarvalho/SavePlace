import type { AnalysisResult, Platform, ProviderUsage } from "../domain/models.js";

export type AnalysisCacheKey = {
  inputUrl: string;
  pipelineVersion: string;
  providerConfigFingerprint: string;
};

export type CachedAnalysis = {
  analysisId: string;
  sourceId: string;
  result: AnalysisResult;
};

export type AnalysisCacheWrite = AnalysisCacheKey & {
  result: AnalysisResult;
};

export interface AnalysisCacheRepository {
  findCachedAnalysis(key: AnalysisCacheKey): Promise<CachedAnalysis | undefined>;
  storeAnalysis(write: AnalysisCacheWrite): Promise<CachedAnalysis>;
}

export type AnalysisCacheResult =
  | { cache: "hit"; analysis: CachedAnalysis }
  | { cache: "miss"; analysis: CachedAnalysis }
  | { cache: "skipped"; result: AnalysisResult };

/**
 * M1.4 calls this before the paid pipeline. A cache hit means no source,
 * extraction, or place-provider request should be repeated.
 */
export class AnalysisCache {
  constructor(private readonly repository: AnalysisCacheRepository) {}

  async getOrCompute(key: AnalysisCacheKey, compute: () => Promise<AnalysisResult>): Promise<AnalysisCacheResult> {
    const cached = await this.repository.findCachedAnalysis(key);
    if (cached) return { cache: "hit", analysis: cached };

    const result = await compute();
    if (!cacheableSource(result, key.inputUrl)) return { cache: "skipped", result };
    const analysis = await this.repository.storeAnalysis({ ...key, result });
    return { cache: "miss", analysis };
  }
}

export function normalizeSubmittedUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function cacheableSource(result: AnalysisResult, inputUrl: string): {
  platform: Platform;
  canonicalUrl: string;
  canonicalContentId?: string;
} | undefined {
  if (result.source.platform === "unknown") return undefined;
  const canonicalUrl = result.source.canonicalUrl ?? normalizeSubmittedUrl(inputUrl);
  if (!canonicalUrl) return undefined;
  return {
    platform: result.source.platform,
    canonicalUrl,
    ...(result.source.contentId ? { canonicalContentId: result.source.contentId } : {}),
  };
}

export function providerUsageFromAnalysis(result: AnalysisResult): ProviderUsage[] {
  const usage = [...(result.processing.resolution?.usage ?? [])];
  const extraction = result.processing.extraction;
  if (!extraction || extraction.status !== "completed") return usage;

  usage.push({
    provider: extraction.provider,
    operation: "place_extraction",
    requests: 1,
    billableUnits: extraction.inputTokens + extraction.outputTokens,
    estimatedCostUsd: extraction.estimatedCostUsd,
    costStatus: "estimated",
  });
  return usage;
}
