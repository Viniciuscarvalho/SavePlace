import { z } from "zod";
import type { PlaceCandidate } from "../domain/models.js";
import type { PlaceMatch, AuditablePlaceProvider, PlaceSearchRun } from "./place-resolver.js";

const GOOGLE_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_TEXT_SEARCH_BUDGET_KEY = "google_places_text_search_pro";

const GooglePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string().min(1) }),
  formattedAddress: z.string().min(1),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  addressComponents: z.array(z.object({
    longText: z.string().min(1),
    shortText: z.string().min(1).optional(),
    types: z.array(z.string().min(1)).min(1),
  })).min(1),
});

const GoogleTextSearchResponseSchema = z.object({ places: z.array(GooglePlaceSchema).max(5) });

export interface UsageLedger {
  tryConsume(input: { key: string; period: string; limit: number }): Promise<boolean>;
}

/**
 * M0-only guard. It prevents accidental spend in one process; M1 replaces it
 * with a transactional Postgres ledger shared by all workers and replicas.
 */
export class InMemoryUsageLedger implements UsageLedger {
  private readonly usage = new Map<string, number>();

  async tryConsume(input: { key: string; period: string; limit: number }): Promise<boolean> {
    const usageKey = `${input.key}:${input.period}`;
    const used = this.usage.get(usageKey) ?? 0;
    if (used >= input.limit) return false;
    this.usage.set(usageKey, used + 1);
    return true;
  }
}

export type GooglePlacesProviderOptions = {
  apiKey: string;
  fetchFn?: typeof fetch;
  usageLedger?: UsageLedger;
  /** A deliberately conservative cap below Google's current free tier. */
  monthlyRequestLimit?: number;
  /** Optional local estimate per Text Search request; it is not a billing source of truth. */
  textSearchEstimatedCostUsd?: number;
  now?: () => Date;
};

function normalized(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function periodAt(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function component(components: z.infer<typeof GooglePlaceSchema>["addressComponents"], type: string): string | undefined {
  return components.find((item) => item.types.includes(type))?.longText;
}

function queryFor(candidate: PlaceCandidate): string {
  return [candidate.rawName, candidate.neighborhoodHint, candidate.cityHint, candidate.countryHint].filter(Boolean).join(", ");
}

function confidenceFor(candidate: PlaceCandidate, providerName: string, address: string): number {
  const candidateName = normalized(candidate.rawName);
  const resultName = normalized(providerName);
  if (!candidateName || !resultName) return 0;

  let confidence = candidateName === resultName ? 0.93 : candidateName.includes(resultName) || resultName.includes(candidateName) ? 0.87 : 0.5;
  const addressNormalized = normalized(address);
  if (candidate.cityHint && addressNormalized.includes(normalized(candidate.cityHint))) confidence += 0.03;
  if (candidate.countryHint && addressNormalized.includes(normalized(candidate.countryHint))) confidence += 0.02;
  return Math.min(confidence, 0.98);
}

/**
 * Uses Google Places Text Search only as an M0 verifier. It asks for the
 * minimum fields needed to validate a candidate and fails closed on invalid,
 * unavailable, or over-budget responses.
 */
export class GooglePlacesProvider implements AuditablePlaceProvider {
  readonly name = "google_places_new";
  private readonly apiKeyValue: string;
  private readonly fetchFn: typeof fetch;
  private readonly usageLedger: UsageLedger;
  private readonly monthlyRequestLimit: number;
  private readonly textSearchEstimatedCostUsd: number | undefined;
  private readonly now: () => Date;

  constructor(options: GooglePlacesProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("Google Places API key must be set.");
    this.apiKeyValue = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    this.usageLedger = options.usageLedger ?? new InMemoryUsageLedger();
    this.monthlyRequestLimit = options.monthlyRequestLimit ?? 500;
    this.textSearchEstimatedCostUsd = options.textSearchEstimatedCostUsd;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.monthlyRequestLimit) || this.monthlyRequestLimit < 1) {
      throw new Error("Google Places monthly request limit must be a positive integer.");
    }
    if (this.textSearchEstimatedCostUsd !== undefined && this.textSearchEstimatedCostUsd < 0) {
      throw new Error("Google Places Text Search estimated cost must be non-negative.");
    }
  }

  async search(candidate: PlaceCandidate): Promise<PlaceMatch[]> {
    return (await this.searchWithTrace(candidate)).matches;
  }

  async searchWithTrace(candidate: PlaceCandidate): Promise<PlaceSearchRun> {
    if (!await this.usageLedger.tryConsume({
      key: GOOGLE_TEXT_SEARCH_BUDGET_KEY,
      period: periodAt(this.now()),
      limit: this.monthlyRequestLimit,
    })) return { matches: [], requestCount: 0 };

    let response: Response;
    try {
      response = await this.fetchFn(GOOGLE_TEXT_SEARCH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKeyValue,
          "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents",
        },
        body: JSON.stringify({ textQuery: queryFor(candidate), languageCode: "pt-BR", maxResultCount: 5 }),
      });
    } catch {
      return { matches: [], requestCount: 1, ...(this.textSearchEstimatedCostUsd === undefined ? {} : { estimatedCostUsd: this.textSearchEstimatedCostUsd }) };
    }

    if (!response.ok) return { matches: [], requestCount: 1, ...(this.textSearchEstimatedCostUsd === undefined ? {} : { estimatedCostUsd: this.textSearchEstimatedCostUsd }) };

    let parsed: z.infer<typeof GoogleTextSearchResponseSchema>;
    try {
      parsed = GoogleTextSearchResponseSchema.parse(await response.json());
    } catch {
      return { matches: [], requestCount: 1, ...(this.textSearchEstimatedCostUsd === undefined ? {} : { estimatedCostUsd: this.textSearchEstimatedCostUsd }) };
    }

    const matches = parsed.places.flatMap((place) => {
      const city = component(place.addressComponents, "locality")
        ?? component(place.addressComponents, "postal_town")
        ?? component(place.addressComponents, "administrative_area_level_2");
      const country = component(place.addressComponents, "country");
      if (!city || !country) return [];

      return [{
        name: place.displayName.text,
        normalizedName: normalized(place.displayName.text),
        address: place.formattedAddress,
        city,
        ...(component(place.addressComponents, "administrative_area_level_1") ? { state: component(place.addressComponents, "administrative_area_level_1") } : {}),
        country,
        latitude: place.location.latitude,
        longitude: place.location.longitude,
        provider: this.name,
        providerPlaceId: place.id,
        resolutionConfidence: confidenceFor(candidate, place.displayName.text, place.formattedAddress),
        verified: true as const,
      }];
    }).sort((left, right) => right.resolutionConfidence - left.resolutionConfidence);
    return { matches, requestCount: 1, ...(this.textSearchEstimatedCostUsd === undefined ? {} : { estimatedCostUsd: this.textSearchEstimatedCostUsd }) };
  }

}
