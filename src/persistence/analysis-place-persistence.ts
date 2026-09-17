import type { AnalysisResult, Evidence, PlaceCandidate, ResolvedPlace } from "../domain/models.js";

export type PersistedAnalysisMention = {
  candidate: PlaceCandidate;
  evidence: Evidence[];
  place?: ResolvedPlace;
};

/**
 * Produces the durable mention records for an analysis without guessing a
 * candidate-to-place relationship. Older cached results did not expose that
 * relationship, so their candidates remain intentionally unresolved.
 */
export function mentionsForPersistence(result: AnalysisResult): PersistedAnalysisMention[] {
  if (result.mentions) {
    return result.mentions.map(({ candidate, place }) => ({
      candidate,
      evidence: candidate.evidence,
      ...(place?.verified === true ? { place } : {}),
    }));
  }

  return result.candidates.map((candidate) => ({ candidate, evidence: candidate.evidence }));
}

/**
 * A provider's identity is authoritative. Keep one representative for each
 * identity before issuing upserts so a repeated place in one analysis cannot
 * make PostgreSQL update the same unique row twice.
 */
export function verifiedPlacesForPersistence(mentions: PersistedAnalysisMention[]): ResolvedPlace[] {
  const byProviderIdentity = new Map<string, ResolvedPlace>();
  for (const mention of mentions) {
    const place = mention.place;
    if (!place || place.verified !== true) continue;

    const identity = `${place.provider}:${place.providerPlaceId}`;
    const current = byProviderIdentity.get(identity);
    if (!current || place.overallConfidence > current.overallConfidence) {
      byProviderIdentity.set(identity, place);
    }
  }
  return [...byProviderIdentity.values()];
}

export function providerPlaceIdentity(place: Pick<ResolvedPlace, "provider" | "providerPlaceId">): string {
  return `${place.provider}:${place.providerPlaceId}`;
}
