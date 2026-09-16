import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadEvaluationCases, runFixtureEvaluation } from "../src/evaluation/runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("M0.5 evaluation runner", () => {
  it("loads committed fixtures without network calls and reports the unmet corpus gate honestly", async () => {
    const cases = await loadEvaluationCases(path.join(root, "evals/cases"));
    const report = await runFixtureEvaluation(cases, path.join(root, "evals/fixtures"));

    expect(report.caseCount).toBe(cases.length);
    expect(report.caseCount).toBeGreaterThanOrEqual(10);
    expect(report.manuallyVerifiedCaseCount).toBeGreaterThanOrEqual(10);
    expect(report.metrics.acquisitionSuccess.denominator).toBeGreaterThan(0);
    expect(report.metrics.candidatePrecision.value).not.toBeNull();
    expect(report.metrics.candidateRecall.value).not.toBeNull();
    expect(report.metrics.endToEndPrecision.value).not.toBeNull();
    expect(report.metrics.resolutionAccuracyByProviderPlaceId.denominator).toBeGreaterThan(0);
    expect(report.metrics.placeProvider.requestCount).toBeGreaterThan(0);
    expect(report.metrics.latencyMs.p50).not.toBeNull();
    expect(report.metrics.latencyMs.p95).not.toBeNull();
    expect(report.gate.ready).toBe(false);
    expect(report.gate.reasons).toContain("requires at least 90% candidate precision on manually verified TikTok cases");
  });
});
