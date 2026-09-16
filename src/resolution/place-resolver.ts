import type { PlaceCandidate, ResolvedPlace } from "../domain/models.js";
import type { ProviderUsage } from "./pricing.js";

// A provider identity match must still be strong on its own (>= 0.85). The
// combined threshold may be lower because social captions commonly expose a
// handle but no independent street/city evidence. This lets a deterministic,
// high-confidence provider match verify an explicitly named venue without
// turning a weak provider match into geographic truth.
export const MINIMUM_PROVIDER_CONFIDENCE = 0.85;
export const MINIMUM_OVERALL_CONFIDENCE = 0.8;

export type PlaceMatch = Omit<ResolvedPlace, "category" | "subcategory" | "extractionConfidence" | "overallConfidence">;

export interface PlaceProvider {
  readonly name: string;
  search(candidate: PlaceCandidate): Promise<PlaceMatch[]>;
}

export type PlaceSearchRun = {
  matches: PlaceMatch[];
  requestCount: number;
  estimatedCostUsd?: number;
  usage?: ProviderUsage[];
};

export interface AuditablePlaceProvider extends PlaceProvider {
  searchWithTrace(candidate: PlaceCandidate): Promise<PlaceSearchRun>;
}

export type ResolutionRun = {
  place: ResolvedPlace | null;
  provider: string;
  requestCount: number;
  estimatedCostUsd?: number;
  usage: ProviderUsage[];
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
    if (!best) return this.emptyResolution(search);

    const overallConfidence = Math.sqrt(candidate.extractionConfidence * best.resolutionConfidence);
    if (best.resolutionConfidence < MINIMUM_PROVIDER_CONFIDENCE || overallConfidence < MINIMUM_OVERALL_CONFIDENCE) {
      return this.emptyResolution(search);
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
      usage: search.usage ?? [],
      ...(search.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: search.estimatedCostUsd }),
    };
  }

  private async search(candidate: PlaceCandidate): Promise<PlaceSearchRun> {
    if (this.isAuditable(this.provider)) return this.provider.searchWithTrace(candidate);
    return { matches: await this.provider.search(candidate), requestCount: 1 };
  }

  private emptyResolution(search: PlaceSearchRun): ResolutionRun {
    return {
      place: null,
      provider: this.provider.name,
      requestCount: search.requestCount,
      usage: search.usage ?? [],
      ...(search.estimatedCostUsd === undefined ? {} : { estimatedCostUsd: search.estimatedCostUsd }),
    };
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
