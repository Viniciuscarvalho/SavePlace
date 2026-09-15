import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEvaluationCases, runFixtureEvaluation } from "../src/evaluation/runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M0.5 evaluation runner", () => {
  it("loads committed fixtures without network calls and reports the unmet corpus gate honestly", async () => {
    const cases = await loadEvaluationCases(path.join(root, "evals/cases"));
    const report = await runFixtureEvaluation(cases, path.join(root, "evals/fixtures"));

    expect(report.caseCount).toBe(3);
    expect(report.manuallyVerifiedCaseCount).toBe(1);
    expect(report.metrics.acquisitionSuccess).toEqual({ numerator: 2, denominator: 2, value: 1 });
    expect(report.metrics.candidatePrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(report.metrics.candidateRecall).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(report.metrics.endToEndPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(report.metrics.resolutionAccuracyByProviderPlaceId.value).toBeNull();
    expect(report.metrics.placeProvider).toEqual({ requestCount: 1, estimatedCostUsd: 0, unpricedRequestCount: 1 });
    expect(report.metrics.latencyMs).toEqual({ p50: 4200, p95: 6000 });
    expect(report.gate.ready).toBe(false);
    expect(report.gate.reasons).toContain("requires at least 10 public TikTok cases; found 2");
  });
});
