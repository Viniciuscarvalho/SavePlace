import type { ProviderUsage } from "../domain/models.js";
import type { EvaluationObservation } from "./contracts.js";

type Ratio = { numerator: number; denominator: number; value: number | null };

export type EvaluationFailureClass =
  | "ACQUISITION_FAILURE"
  | "INSUFFICIENT_EVIDENCE"
  | "EXTRACTION_FALSE_POSITIVE"
  | "EXTRACTION_FALSE_NEGATIVE"
  | "WRONG_ENTITY"
  | "AMBIGUOUS_ENTITY"
  | "RESOLUTION_FAILURE"
  | "WRONG_RESOLUTION"
  | "PROVIDER_FAILURE"
  | "CLASSIFICATION_FAILURE";

export type EvaluationCaseReport = {
  id: string;
  input: string;
  expectedAcquisition: string;
  actualAcquisition: string;
  expectedDecision: string;
  actualDecision: string;
  processable: boolean;
  expectedCandidateCount: number;
  extractedCandidateCount: number;
  correctCandidateCount: number;
  falsePositiveCount: number;
  falseNegativeCount: number;
  expectedPlaceCount: number;
  expectedResolutionCount: number;
  resolvedCandidateCount: number;
  correctResolutionCount: number;
  correctExpectedResolutionCount: number;
  failureClasses: EvaluationFailureClass[];
};

export type EvaluationReport = {
  version: "m0.5-v2";
  mode: "fixture" | "live";
  caseCount: number;
  totalUrls: number;
  m0TikTokCaseCount: number;
  processableUrls: number;
  successfulAcquisitions: number;
  manuallyVerifiedCaseCount: number;
  pendingHumanVerificationCaseCount: number;
  metrics: {
    acquisitionSuccess: Ratio;
    acquisitionExpectationMatch: Ratio;
    expectedPlaces: number;
    expectedResolutionTargets: number;
    extractedCandidates: number;
    correctCandidates: number;
    falsePositives: number;
    falseNegatives: number;
    candidatePrecision: Ratio;
    candidateRecall: Ratio;
    falsePositiveRate: Ratio;
    resolvedCandidates: number;
    correctResolutions: number;
    /** Correct provider identities divided by expected verified-place identities. */
    resolutionAccuracyByProviderPlaceId: Ratio;
    /** Correct provider identities divided by emitted verified places. */
    resolutionPrecision: Ratio;
    endToEndPrecision: Ratio;
    falsePositiveCount: number;
    insufficientEvidenceCount: number;
    needsReviewCount: number;
    needsReviewRate: Ratio;
    decisionExpectationMatch: Ratio;
    latencyMs: { p50: number | null; p95: number | null };
    llm: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
    placeProvider: {
      requestCount: number;
      billableUnits: number;
      estimatedCostUsd: number | null;
      costStatus: "estimated" | "pricing_not_configured";
      unpricedRequestCount: number;
      usage: ProviderUsage[];
    };
    totalEstimatedCostUsd: number | null;
    costPerUrlUsd: number | null;
    costPerCandidateUsd: number | null;
    costPerVerifiedPlaceUsd: number | null;
    estimatedCostPerVerifiedPlaceUsd: number | null;
  };
  cases: EvaluationCaseReport[];
  gate: { ready: boolean; reasons: string[] };
};

function normalized(value: string): string {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function compact(value: string): string {
  return normalized(value).replace(/\s+/g, "").replace(/official$/u, "");
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

type ExpectedCandidate = { name: string; category?: string | undefined; city?: string | undefined };
type ActualCandidate = { rawName: string; category: string; cityHint?: string | undefined };
type ExpectedPlace = ExpectedCandidate & { provider?: string | undefined; providerPlaceId?: string | undefined; resolutionExpected: boolean };
type ActualPlace = { name: string; city: string; provider: string; providerPlaceId: string };

function candidateMatches(expected: ExpectedCandidate, actual: ActualCandidate): boolean {
  return compact(expected.name) === compact(actual.rawName)
    && (expected.category === undefined || expected.category === actual.category)
    // A manual city ground truth may be known even when the acquired caption
    // does not literally expose it. Absence of a hint is not a wrong entity;
    // a conflicting observed hint is.
    && (expected.city === undefined || actual.cityHint === undefined || compact(expected.city) === compact(actual.cityHint));
}

function sameCandidateName(expected: ExpectedCandidate, actual: ActualCandidate): boolean {
  return compact(expected.name) === compact(actual.rawName);
}

function placeMatches(expected: ExpectedPlace, actual: ActualPlace): boolean {
  if (expected.providerPlaceId) return expected.provider === actual.provider && expected.providerPlaceId === actual.providerPlaceId;
  return normalized(expected.name) === normalized(actual.name)
    && (expected.city === undefined || normalized(expected.city) === normalized(actual.city));
}

function matchedCount<TActual, TExpected>(actual: TActual[], expected: TExpected[], matches: (expected: TExpected, actual: TActual) => boolean): number {
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

function caseReport(observation: EvaluationObservation): EvaluationCaseReport {
  const { evaluationCase, acquisition, analysis } = observation;
  const expectedCandidates = evaluationCase.expected.candidates;
  const actualCandidates = analysis.candidates;
  const expectedPlaces = evaluationCase.expected.places;
  const actualPlaces = analysis.places;
  const correctCandidateCount = matchedCount(actualCandidates, expectedCandidates, candidateMatches);
  const correctResolutionCount = matchedCount(actualPlaces, expectedPlaces, placeMatches);
  const correctExpectedResolutionCount = matchedCount(actualPlaces, expectedPlaces.filter((place) => place.resolutionExpected), placeMatches);
  const failures = new Set<EvaluationFailureClass>();

  if (acquisition !== evaluationCase.expected.acquisition) {
    failures.add(acquisition === "insufficient_evidence" ? "INSUFFICIENT_EVIDENCE" : "ACQUISITION_FAILURE");
  }
  if (analysis.processing.extraction?.status === "failed" && expectedCandidates.length > actualCandidates.length) failures.add("PROVIDER_FAILURE");

  for (const expected of expectedCandidates) {
    if (actualCandidates.some((actual) => candidateMatches(expected, actual))) continue;
    failures.add(actualCandidates.some((actual) => sameCandidateName(expected, actual)) ? "WRONG_ENTITY" : "EXTRACTION_FALSE_NEGATIVE");
  }
  for (const actual of actualCandidates) {
    if (!expectedCandidates.some((expected) => candidateMatches(expected, actual))) failures.add("EXTRACTION_FALSE_POSITIVE");
  }
  for (const expected of expectedPlaces) {
    if (expected.resolutionExpected && !actualPlaces.some((actual) => placeMatches(expected, actual)) && actualCandidates.some((actual) => candidateMatches(expected, actual))) {
      failures.add("RESOLUTION_FAILURE");
    }
  }
  const expectedResolutionCount = expectedPlaces.filter((place) => place.resolutionExpected).length;
  if (correctExpectedResolutionCount < expectedResolutionCount && correctCandidateCount === expectedCandidates.length) {
    failures.add("RESOLUTION_FAILURE");
  }
  for (const actual of actualPlaces) {
    if (!expectedPlaces.some((expected) => placeMatches(expected, actual))) failures.add("WRONG_RESOLUTION");
  }
  if (analysis.status !== evaluationCase.expected.decision) {
    failures.add(evaluationCase.expected.decision === "needs_review" && analysis.status === "completed" ? "AMBIGUOUS_ENTITY" : "CLASSIFICATION_FAILURE");
  }

  return {
    id: evaluationCase.id,
    input: evaluationCase.input,
    expectedAcquisition: evaluationCase.expected.acquisition,
    actualAcquisition: acquisition,
    expectedDecision: evaluationCase.expected.decision,
    actualDecision: analysis.status,
    processable: acquisition === "acquired",
    expectedCandidateCount: expectedCandidates.length,
    extractedCandidateCount: actualCandidates.length,
    correctCandidateCount,
    falsePositiveCount: actualCandidates.length - correctCandidateCount,
    falseNegativeCount: expectedCandidates.length - correctCandidateCount,
    expectedPlaceCount: expectedPlaces.length,
    expectedResolutionCount,
    resolvedCandidateCount: actualPlaces.length,
    correctResolutionCount,
    correctExpectedResolutionCount,
    failureClasses: [...failures],
  };
}

function aggregateUsage(observations: EvaluationObservation[]): ProviderUsage[] {
  const usages = observations.flatMap(({ analysis }) => {
    const resolution = analysis.processing.resolution;
    if (!resolution) return [];
    if (resolution.usage && resolution.usage.length > 0) return resolution.usage;
    if (resolution.requestCount === 0) return [];
    return [{ provider: resolution.provider, operation: "unknown", requests: resolution.requestCount, billableUnits: resolution.requestCount, estimatedCostUsd: null, costStatus: "pricing_not_configured" as const }];
  });
  const grouped = new Map<string, ProviderUsage>();
  for (const usage of usages) {
    const key = `${usage.provider}:${usage.operation}:${usage.costStatus}:${usage.pricingSource ?? ""}:${usage.pricingEffectiveDate ?? ""}`;
    const current = grouped.get(key);
    grouped.set(key, {
      provider: usage.provider,
      operation: usage.operation,
      costStatus: usage.costStatus,
      ...(usage.pricingSource ? { pricingSource: usage.pricingSource } : {}),
      ...(usage.pricingEffectiveDate ? { pricingEffectiveDate: usage.pricingEffectiveDate } : {}),
      requests: (current?.requests ?? 0) + usage.requests,
      billableUnits: (current?.billableUnits ?? 0) + usage.billableUnits,
      estimatedCostUsd: usage.estimatedCostUsd === null || current?.estimatedCostUsd === null ? null : (current?.estimatedCostUsd ?? 0) + usage.estimatedCostUsd,
    });
  }
  return [...grouped.values()];
}

export function calculateEvaluationReport(mode: EvaluationReport["mode"], observations: EvaluationObservation[]): EvaluationReport {
  const m0Observations = observations.filter(({ evaluationCase }) => evaluationCase.platform === "tiktok");
  const verified = m0Observations.filter(({ evaluationCase }) => evaluationCase.expected.manualStatus === "verified");
  const reports = m0Observations.map(caseReport);
  const acquired = m0Observations.filter(({ acquisition }) => acquisition === "acquired");
  const acquisitionExpectationMatches = m0Observations.filter(({ evaluationCase, acquisition }) => evaluationCase.expected.acquisition === acquisition);
  const decisionExpectationMatches = m0Observations.filter(({ evaluationCase, analysis }) => evaluationCase.expected.decision === analysis.status);
  const expectedPlaces = reports.reduce((sum, report) => sum + report.expectedPlaceCount, 0);
  const expectedResolutionTargets = reports.reduce((sum, report) => sum + report.expectedResolutionCount, 0);
  const extractedCandidates = reports.reduce((sum, report) => sum + report.extractedCandidateCount, 0);
  const correctCandidates = reports.reduce((sum, report) => sum + report.correctCandidateCount, 0);
  const falsePositives = reports.reduce((sum, report) => sum + report.falsePositiveCount, 0);
  const falseNegatives = reports.reduce((sum, report) => sum + report.falseNegativeCount, 0);
  const expectedCandidates = reports.reduce((sum, report) => sum + report.expectedCandidateCount, 0);
  const resolvedCandidates = reports.reduce((sum, report) => sum + report.resolvedCandidateCount, 0);
  const correctResolutions = reports.reduce((sum, report) => sum + report.correctExpectedResolutionCount, 0);
  const inputTokens = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.inputTokens ?? 0), 0);
  const outputTokens = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.outputTokens ?? 0), 0);
  const llmCost = m0Observations.reduce((sum, { analysis }) => sum + (analysis.processing.extraction?.estimatedCostUsd ?? 0), 0);
  const usage = aggregateUsage(m0Observations);
  const requestCount = usage.reduce((sum, item) => sum + item.requests, 0);
  const billableUnits = usage.reduce((sum, item) => sum + item.billableUnits, 0);
  const unpricedRequestCount = usage.filter((item) => item.costStatus === "pricing_not_configured").reduce((sum, item) => sum + item.requests, 0);
  const placeProviderCost = unpricedRequestCount === 0 ? usage.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0) : null;
  const totalEstimatedCostUsd = placeProviderCost === null ? null : llmCost + placeProviderCost;
  const needsReviewCount = m0Observations.filter(({ analysis }) => analysis.status === "needs_review").length;
  const insufficientEvidenceCount = m0Observations.filter(({ analysis }) => analysis.status === "insufficient_evidence").length;
  const candidatePrecision = ratio(correctCandidates, extractedCandidates);
  const resolutionCoverage = ratio(correctResolutions, expectedResolutionTargets);

  const reasons: string[] = [];
  if (m0Observations.length < 10) reasons.push(`requires at least 10 public TikTok cases; found ${m0Observations.length}`);
  if (verified.length < 10) reasons.push(`requires at least 10 manually verified cases; found ${verified.length}`);
  if (expectedResolutionTargets === 0) reasons.push("requires manually verified provider/place IDs before resolution accuracy can be measured");
  if (unpricedRequestCount > 0) reasons.push(`${unpricedRequestCount} PlaceProvider request(s) have no local pricing configuration`);
  if (candidatePrecision.value === null || candidatePrecision.value < 0.9) reasons.push("requires at least 90% candidate precision on manually verified TikTok cases");
  if (resolutionCoverage.value === null || resolutionCoverage.value < 0.95) reasons.push("requires at least 95% verified-place resolution accuracy against expected identities");

  const costPerUrlUsd = totalEstimatedCostUsd === null ? null : totalEstimatedCostUsd / m0Observations.length;
  const costPerCandidateUsd = totalEstimatedCostUsd === null || extractedCandidates === 0 ? null : totalEstimatedCostUsd / extractedCandidates;
  const costPerVerifiedPlaceUsd = totalEstimatedCostUsd === null || resolvedCandidates === 0 ? null : totalEstimatedCostUsd / resolvedCandidates;

  return {
    version: "m0.5-v2",
    mode,
    caseCount: observations.length,
    totalUrls: m0Observations.length,
    m0TikTokCaseCount: m0Observations.length,
    processableUrls: acquired.length,
    successfulAcquisitions: acquired.length,
    manuallyVerifiedCaseCount: verified.length,
    pendingHumanVerificationCaseCount: m0Observations.length - verified.length,
    metrics: {
      acquisitionSuccess: ratio(acquired.length, m0Observations.length),
      acquisitionExpectationMatch: ratio(acquisitionExpectationMatches.length, m0Observations.length),
      expectedPlaces,
      expectedResolutionTargets,
      extractedCandidates,
      correctCandidates,
      falsePositives,
      falseNegatives,
      candidatePrecision,
      candidateRecall: ratio(correctCandidates, expectedCandidates),
      falsePositiveRate: ratio(falsePositives, extractedCandidates),
      resolvedCandidates,
      correctResolutions,
      resolutionAccuracyByProviderPlaceId: resolutionCoverage,
      resolutionPrecision: ratio(correctResolutions, resolvedCandidates),
      endToEndPrecision: ratio(correctResolutions, resolvedCandidates),
      falsePositiveCount: falsePositives,
      insufficientEvidenceCount,
      needsReviewCount,
      needsReviewRate: ratio(needsReviewCount, m0Observations.length),
      decisionExpectationMatch: ratio(decisionExpectationMatches.length, m0Observations.length),
      latencyMs: { p50: percentile(m0Observations.map(({ analysis }) => analysis.processing.durationMs), 0.5), p95: percentile(m0Observations.map(({ analysis }) => analysis.processing.durationMs), 0.95) },
      llm: { inputTokens, outputTokens, estimatedCostUsd: llmCost },
      placeProvider: { requestCount, billableUnits, estimatedCostUsd: placeProviderCost, costStatus: placeProviderCost === null ? "pricing_not_configured" : "estimated", unpricedRequestCount, usage },
      totalEstimatedCostUsd,
      costPerUrlUsd,
      costPerCandidateUsd,
      costPerVerifiedPlaceUsd,
      estimatedCostPerVerifiedPlaceUsd: costPerVerifiedPlaceUsd,
    },
    cases: reports,
    gate: { ready: reasons.length === 0, reasons },
  };
}
