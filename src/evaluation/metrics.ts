import type { EvaluationObservation } from "./contracts.js";

type Ratio = { numerator: number; denominator: number; value: number | null };

export type EvaluationReport = {
  version: "m0.5-v1";
  mode: "fixture" | "live";
  caseCount: number;
  m0TikTokCaseCount: number;
  manuallyVerifiedCaseCount: number;
  pendingHumanVerificationCaseCount: number;
  metrics: {
    acquisitionSuccess: Ratio;
    acquisitionExpectationMatch: Ratio;
    candidatePrecision: Ratio;
    candidateRecall: Ratio;
    resolutionAccuracyByProviderPlaceId: Ratio;
    endToEndPrecision: Ratio;
    falsePositiveCount: number;
    needsReviewRate: Ratio;
    decisionExpectationMatch: Ratio;
    latencyMs: { p50: number | null; p95: number | null };
    llm: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
    placeProvider: { requestCount: number; estimatedCostUsd: number; unpricedRequestCount: number };
    totalEstimatedCostUsd: number;
    estimatedCostPerVerifiedPlaceUsd: number | null;
  };
  gate: { ready: boolean; reasons: string[] };
};

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function ratio(numerator: number, denominator: number): Ratio {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(percentileValue * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? null;
}

function candidateMatches(expected: { name: string; category?: string | undefined; city?: string | undefined }, actual: { rawName: string; category: string; cityHint?: string | undefined }): boolean {
  return normalized(expected.name) === normalized(actual.rawName)
    && (expected.category === undefined || expected.category === actual.category)
    && (expected.city === undefined || normalized(expected.city) === normalized(actual.cityHint ?? ""));
}

function placeMatches(expected: { name: string; city?: string | undefined; provider?: string | undefined; providerPlaceId?: string | undefined }, actual: { name: string; city: string; provider: string; providerPlaceId: string }): boolean {
  if (expected.providerPlaceId) return expected.provider === actual.provider && expected.providerPlaceId === actual.providerPlaceId;
  return normalized(expected.name) === normalized(actual.name)
    && (expected.city === undefined || normalized(expected.city) === normalized(actual.city));
}

function countMatched<TActual, TExpected>(actual: TActual[], expected: TExpected[], matches: (expected: TExpected, actual: TActual) => boolean): number {
  const remaining = new Set(expected.keys());
  let count = 0;
  for (const actualValue of actual) {
    const expectedIndex = [...remaining].find((index) => matches(expected[index]!, actualValue));
    if (expectedIndex !== undefined) {
      remaining.delete(expectedIndex);
      count += 1;
    }
  }
  return count;
}

export function calculateEvaluationReport(mode: EvaluationReport["mode"], observations: EvaluationObservation[]): EvaluationReport {
  const m0Observations = observations.filter(({ evaluationCase }) => evaluationCase.platform === "tiktok");
  const verified = m0Observations.filter(({ evaluationCase }) => evaluationCase.expected.manualStatus === "verified");
  const acquired = m0Observations.filter(({ acquisition }) => acquisition === "acquired");
  const acquisitionExpectationMatches = m0Observations.filter(({ evaluationCase, acquisition }) => evaluationCase.expected.acquisition === acquisition);
  const decisionExpectationMatches = m0Observations.filter(({ evaluationCase, analysis }) => evaluationCase.expected.decision === analysis.status);

  const expectedCandidates = verified.flatMap(({ evaluationCase }) => evaluationCase.expected.candidates);
  const actualCandidates = verified.flatMap(({ analysis }) => analysis.candidates);
  const candidateMatchesCount = countMatched(actualCandidates, expectedCandidates, candidateMatches);

  const expectedPlaces = verified.flatMap(({ evaluationCase }) => evaluationCase.expected.places);
  const actualPlaces = verified.flatMap(({ analysis }) => analysis.places);
  const placeMatchesCount = countMatched(actualPlaces, expectedPlaces, placeMatches);
  const expectedProviderIds = expectedPlaces.filter((place) => place.provider !== undefined && place.providerPlaceId !== undefined);
  const actualProviderIds = actualPlaces.filter((place) => expectedProviderIds.some((expected) => expected.provider === place.provider && expected.providerPlaceId === place.providerPlaceId));

  const inputTokens = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.inputTokens ?? 0), 0);
  const outputTokens = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.outputTokens ?? 0), 0);
  const llmCost = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.estimatedCostUsd ?? 0), 0);
  const providerRequestCount = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.resolution?.requestCount ?? 0), 0);
  const providerCost = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.resolution?.estimatedCostUsd ?? 0), 0);
  const unpricedRequestCount = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.resolution?.unpricedRequestCount ?? 0), 0);
  const totalEstimatedCostUsd = llmCost + providerCost;
  const needsReviewCount = m0Observations.filter(({ analysis }) => analysis.status === "needs_review").length;

  const reasons: string[] = [];
  const publicTikTokCases = m0Observations.length;
  if (publicTikTokCases < 10) reasons.push(`requires at least 10 public TikTok cases; found ${publicTikTokCases}`);
  if (verified.length < 10) reasons.push(`requires at least 10 manually verified cases; found ${verified.length}`);
  if (expectedProviderIds.length === 0) reasons.push("requires manually verified provider/place IDs before resolution accuracy can be measured");
  if (unpricedRequestCount > 0) reasons.push(`${unpricedRequestCount} PlaceProvider request(s) have no local cost estimate`);
  const candidatePrecision = ratio(candidateMatchesCount, actualCandidates.length);
  const resolutionAccuracy = ratio(actualProviderIds.length, expectedProviderIds.length);
  if (candidatePrecision.value === null || candidatePrecision.value < 0.9) reasons.push("requires at least 90% candidate precision on manually verified TikTok cases");
  if (resolutionAccuracy.value === null || resolutionAccuracy.value < 0.95) reasons.push("requires at least 95% resolution accuracy by provider/place ID");

  return {
    version: "m0.5-v1",
    mode,
    caseCount: observations.length,
    m0TikTokCaseCount: m0Observations.length,
    manuallyVerifiedCaseCount: verified.length,
    pendingHumanVerificationCaseCount: m0Observations.length - verified.length,
    metrics: {
      acquisitionSuccess: ratio(acquired.length, m0Observations.length),
      acquisitionExpectationMatch: ratio(acquisitionExpectationMatches.length, m0Observations.length),
      candidatePrecision,
      candidateRecall: ratio(candidateMatchesCount, expectedCandidates.length),
      resolutionAccuracyByProviderPlaceId: resolutionAccuracy,
      endToEndPrecision: ratio(placeMatchesCount, actualPlaces.length),
      falsePositiveCount: actualPlaces.length - placeMatchesCount,
      needsReviewRate: ratio(needsReviewCount, m0Observations.length),
      decisionExpectationMatch: ratio(decisionExpectationMatches.length, m0Observations.length),
      latencyMs: { p50: percentile(m0Observations.map(({ analysis }) => analysis.processing.durationMs), 0.5), p95: percentile(m0Observations.map(({ analysis }) => analysis.processing.durationMs), 0.95) },
      llm: { inputTokens, outputTokens, estimatedCostUsd: llmCost },
      placeProvider: { requestCount: providerRequestCount, estimatedCostUsd: providerCost, unpricedRequestCount },
      totalEstimatedCostUsd,
      estimatedCostPerVerifiedPlaceUsd: actualPlaces.length === 0 ? null : totalEstimatedCostUsd / actualPlaces.length,
    },
    gate: { ready: reasons.length === 0, reasons },
  };
}
