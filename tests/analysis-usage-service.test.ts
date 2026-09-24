import { describe, expect, it } from "vitest";
import { AnalysisUsageService, type AnalysisUsageMetric, type AnalysisUsageRepository } from "../src/application/analysis-usage-service.js";

class UsageRepositoryMemory implements AnalysisUsageRepository {
  readonly counts = new Map<string, number>();
  readonly metrics: AnalysisUsageMetric[] = [];

  async tryConsumeUserAnalysis(input: { userId: string; period: string; limit: number }): Promise<boolean> {
    const key = `${input.userId}:${input.period}`;
    const count = this.counts.get(key) ?? 0;
    if (count >= input.limit) return false;
    this.counts.set(key, count + 1);
    return true;
  }

  async recordAnalysisMetric(metric: AnalysisUsageMetric): Promise<void> {
    this.metrics.push(metric);
  }

  async listAnalysisMetrics(period: string): Promise<AnalysisUsageMetric[]> {
    return this.metrics.filter((metric) => metric.period === period);
  }
}

describe("AnalysisUsageService", () => {
  it("enforces a monthly user limit and keeps metrics free of user data", async () => {
    const repository = new UsageRepositoryMemory();
    const service = new AnalysisUsageService({ repository, monthlyLimit: 1, now: () => new Date("2026-09-23T12:00:00.000Z") });

    await expect(service.consumeBeforePaidAnalysis("user-a")).resolves.toBeUndefined();
    await expect(service.consumeBeforePaidAnalysis("user-a")).rejects.toMatchObject({ response: { responseStatus: 429, responseBody: { error: "user_analysis_limit_exceeded", retryAt: "2026-10-01T00:00:00.000Z" } } });
    await expect(service.consumeBeforePaidAnalysis("user-b")).resolves.toBeUndefined();

    await service.record({ cache: "miss", durationMs: 20, estimatedCostUsd: 0.01 });
    expect(repository.metrics).toEqual([{ period: "2026-09", cache: "miss", durationMs: 20, estimatedCostUsd: 0.01 }]);
  });

  it("reports cache rate, nearest-rank latency percentiles, and unknown costs honestly", async () => {
    const repository = new UsageRepositoryMemory();
    const service = new AnalysisUsageService({ repository, monthlyLimit: 1, now: () => new Date("2026-09-23T12:00:00.000Z") });
    for (const metric of [
      { cache: "hit" as const, durationMs: 10, estimatedCostUsd: 0 },
      { cache: "miss" as const, durationMs: 20, estimatedCostUsd: 0.01 },
      { cache: "hit" as const, durationMs: 30, estimatedCostUsd: null },
      { cache: "skipped" as const, durationMs: 40, estimatedCostUsd: 0 },
    ]) await service.record(metric);

    await expect(service.summary()).resolves.toEqual({
      period: "2026-09", analysisCount: 4, cacheHitRate: 2 / 3,
      p50LatencyMs: 20, p95LatencyMs: 40, estimatedCostUsd: null, unpricedAnalysisCount: 1,
    });
  });
});
