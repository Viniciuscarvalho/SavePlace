import { IdempotencyResponseError, type StoredIdempotencyResponse } from "../persistence/idempotency.js";

export type AnalysisCacheOutcome = "hit" | "miss" | "skipped";

export type AnalysisUsageMetric = {
  period: string;
  cache: AnalysisCacheOutcome;
  durationMs: number;
  estimatedCostUsd: number | null;
};

export type AnalysisUsageSummary = {
  period: string;
  analysisCount: number;
  cacheHitRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  estimatedCostUsd: number | null;
  unpricedAnalysisCount: number;
};

export interface AnalysisUsageRepository {
  tryConsumeUserAnalysis(input: { userId: string; period: string; limit: number }): Promise<boolean>;
  recordAnalysisMetric(metric: AnalysisUsageMetric): Promise<void>;
  listAnalysisMetrics(period: string): Promise<AnalysisUsageMetric[]>;
}

export class UserAnalysisLimitExceededError extends IdempotencyResponseError {
  constructor(public readonly retryAt: string) {
    super({ responseStatus: 429, responseBody: { error: "user_analysis_limit_exceeded", retryAt } });
  }
}

export class AnalysisUsageService {
  constructor(private readonly options: { repository: AnalysisUsageRepository; monthlyLimit: number; now?: () => Date }) {
    if (!Number.isInteger(options.monthlyLimit) || options.monthlyLimit < 1) throw new Error("monthlyLimit must be a positive integer.");
  }

  async consumeBeforePaidAnalysis(userId: string): Promise<void> {
    const now = this.now();
    if (!await this.options.repository.tryConsumeUserAnalysis({ userId, period: periodAt(now), limit: this.options.monthlyLimit })) {
      throw new UserAnalysisLimitExceededError(nextPeriodAt(now).toISOString());
    }
  }

  async record(metric: Omit<AnalysisUsageMetric, "period">): Promise<void> {
    if (!Number.isFinite(metric.durationMs) || metric.durationMs < 0) throw new Error("durationMs must be a non-negative finite number.");
    if (metric.estimatedCostUsd !== null && (!Number.isFinite(metric.estimatedCostUsd) || metric.estimatedCostUsd < 0)) throw new Error("estimatedCostUsd must be non-negative or null.");
    await this.options.repository.recordAnalysisMetric({ ...metric, period: periodAt(this.now()) });
  }

  async summary(period = periodAt(this.now())): Promise<AnalysisUsageSummary> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error("period must use YYYY-MM.");
    const metrics = await this.options.repository.listAnalysisMetrics(period);
    const durations = metrics.map((metric) => metric.durationMs).sort((left, right) => left - right);
    const unpricedAnalysisCount = metrics.filter((metric) => metric.estimatedCostUsd === null).length;
    const cacheable = metrics.filter((metric) => metric.cache === "hit" || metric.cache === "miss");
    return {
      period,
      analysisCount: metrics.length,
      cacheHitRate: cacheable.length === 0 ? null : cacheable.filter((metric) => metric.cache === "hit").length / cacheable.length,
      p50LatencyMs: percentile(durations, 0.5),
      p95LatencyMs: percentile(durations, 0.95),
      estimatedCostUsd: unpricedAnalysisCount === 0 ? metrics.reduce((sum, metric) => sum + (metric.estimatedCostUsd ?? 0), 0) : null,
      unpricedAnalysisCount,
    };
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

function periodAt(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextPeriodAt(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

function percentile(sorted: number[], quantile: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? null;
}
