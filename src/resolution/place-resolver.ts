import type { PlaceCandidate, ResolvedPlace } from "../domain/models.js";

export type PlaceMatch = Omit<ResolvedPlace, "category" | "subcategory" | "extractionConfidence" | "overallConfidence">;

export interface PlaceProvider {
  readonly name: string;
  search(candidate: PlaceCandidate): Promise<PlaceMatch[]>;
}

export type PlaceSearchRun = {
  matches: PlaceMatch[];
  requestCount: number;
  estimatedCostUsd?: number;
};

export interface AuditablePlaceProvider extends PlaceProvider {
  searchWithTrace(candidate: PlaceCandidate): Promise<PlaceSearchRun>;
}

export type ResolutionRun = {
  place: ResolvedPlace | null;
  provider: string;
  requestCount: number;
  estimatedCostUsd?: number;
};

export class PlaceResolver {
  constructor(private readonly provider: PlaceProvider) {}

  async resolve(candidate: PlaceCandidate): Promise<ResolvedPlace | null> {
    return (await this.resolveWithTrace(candidate)).place;
  }

  async resolveWithTrace(candidate: PlaceCandidate): Promise<ResolutionRun> {
    const search = await this.search(candidate);
    const matches = search.matches;
    const best = matches[0];
    if (!best) return { place: null, provider: this.provider.name, requestCount: search.requestCount, ...(search.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: search.estimatedCostUsd }) };

    const overallConfidence = Math.sqrt(candidate.extractionConfidence * best.resolutionConfidence);
    if (best.resolutionConfidence < 0.85 || overallConfidence < 0.85) {
      return { place: null, provider: this.provider.name, requestCount: search.requestCount, ...(search.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: search.estimatedCostUsd }) };
    }

    return {
      place: {
        ...best,
        category: candidate.category,
        ...(candidate.subcategory ? { subcategory: candidate.subcategory } : {}),
        extractionConfidence: candidate.extractionConfidence,
        overallConfidence,
      },
      provider: this.provider.name,
      requestCount: search.requestCount,
      ...(search.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: search.estimatedCostUsd }),
    };
  }

  private async search(candidate: PlaceCandidate): Promise<PlaceSearchRun> {
    if (this.isAuditable(this.provider)) return this.provider.searchWithTrace(candidate);
    return { matches: await this.provider.search(candidate), requestCount: 1 };
  }

  private isAuditable(provider: PlaceProvider): provider is AuditablePlaceProvider {
    return "searchWithTrace" in provider && typeof provider.searchWithTrace === "function";
  }
}

export class EmptyPlaceProvider implements AuditablePlaceProvider {
  readonly name = "empty-m0-provider";
  async search(_candidate: PlaceCandidate): Promise<PlaceMatch[]> {
    return [];
  }

  async searchWithTrace(candidate: PlaceCandidate): Promise<PlaceSearchRun> {
    return { matches: await this.search(candidate), requestCount: 0 };
  }
}
