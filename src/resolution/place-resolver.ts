import type { PlaceCandidate, ResolvedPlace } from "../domain/models.js";

export type PlaceMatch = Omit<ResolvedPlace, "category" | "subcategory" | "extractionConfidence" | "overallConfidence">;

export interface PlaceProvider {
  readonly name: string;
  search(candidate: PlaceCandidate): Promise<PlaceMatch[]>;
}

export class PlaceResolver {
  constructor(private readonly provider: PlaceProvider) {}

  async resolve(candidate: PlaceCandidate): Promise<ResolvedPlace | null> {
    const matches = await this.provider.search(candidate);
    const best = matches[0];
    if (!best) return null;

    const overallConfidence = Math.sqrt(candidate.extractionConfidence * best.resolutionConfidence);
    if (best.resolutionConfidence < 0.85 || overallConfidence < 0.85) return null;

    return {
      ...best,
      category: candidate.category,
      ...(candidate.subcategory ? { subcategory: candidate.subcategory } : {}),
      extractionConfidence: candidate.extractionConfidence,
      overallConfidence,
    };
  }
}

export class EmptyPlaceProvider implements PlaceProvider {
  readonly name = "empty-m0-provider";
  async search(_candidate: PlaceCandidate): Promise<PlaceMatch[]> {
    return [];
  }
}
