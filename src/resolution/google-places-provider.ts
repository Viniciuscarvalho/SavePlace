import { z } from "zod";
import type { PlaceCandidate } from "../domain/models.js";
import type { PlaceMatch, AuditablePlaceProvider, PlaceSearchRun } from "./place-resolver.js";
import { usageFor, type ProviderPricing, type ProviderUsage } from "./pricing.js";

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
  /** Explicit local pricing configuration. It is not a billing source of truth. */
  pricing?: ProviderPricing;
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

function streetHintFor(candidate: PlaceCandidate): string | undefined {
  const rawName = candidate.rawName.toLocaleLowerCase("pt-BR");
  for (const evidence of candidate.evidence) {
    const text = evidence.text;
    const start = text.toLocaleLowerCase("pt-BR").indexOf(rawName);
    if (start < 0) continue;
    const nextHandle = text.indexOf("@", start + candidate.rawName.length);
    const segment = text.slice(start, nextHandle >= 0 ? nextHandle : start + 240);
    const match = segment.match(/(?:rua|r\.|avenida|av\.)\s+[^@#\n]{1,80}?,\s*\d{1,5}/iu);
    if (match?.[0]) return match[0].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function queryFor(candidate: PlaceCandidate): string {
  return [candidate.normalizedName ?? candidate.rawName, streetHintFor(candidate), candidate.neighborhoodHint, candidate.cityHint, candidate.countryHint].filter(Boolean).join(", ");
}

function hasLiteral(value: string | undefined, target: string): boolean {
  return value !== undefined && compact(target).includes(compact(value));
}

function compact(value: string): string {
  return normalized(value).replace(/\s+/g, "");
}

function tokenSignature(value: string): string {
  return [...new Set(normalized(value).split(" ").filter(Boolean))].sort().join(" ");
}

/**
 * Deterministic M0 ranking: name identity dominates, then observable locality
 * agreement. Missing or conflicting locality evidence can only lower a score.
 */
export function confidenceFor(candidate: PlaceCandidate, providerName: string, address: string): number {
  const candidateName = normalized(candidate.normalizedName ?? candidate.rawName);
  const resultName = normalized(providerName);
  if (!candidateName || !resultName) return 0;

  const sameName = candidateName === resultName
    || compact(candidateName) === compact(resultName)
    || tokenSignature(candidateName) === tokenSignature(resultName);
  let confidence = sameName ? 0.93 : candidateName.includes(resultName) || resultName.includes(candidateName) ? 0.87 : 0.5;
  if (candidate.cityHint) confidence += hasLiteral(candidate.cityHint, address) ? 0.04 : -0.12;
  if (candidate.neighborhoodHint) confidence += hasLiteral(candidate.neighborhoodHint, address) ? 0.04 : -0.05;
  if (candidate.countryHint) confidence += hasLiteral(candidate.countryHint, address) ? 0.02 : -0.05;
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
  private readonly pricing: ProviderPricing | undefined;
  private readonly now: () => Date;

  constructor(options: GooglePlacesProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("Google Places API key must be set.");
    this.apiKeyValue = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
    this.usageLedger = options.usageLedger ?? new InMemoryUsageLedger();
    this.monthlyRequestLimit = options.monthlyRequestLimit ?? 500;
    this.pricing = options.pricing;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.monthlyRequestLimit) || this.monthlyRequestLimit < 1) {
      throw new Error("Google Places monthly request limit must be a positive integer.");
    }
    if (this.pricing && (this.pricing.provider !== this.name || this.pricing.operation !== "text_search")) {
      throw new Error("Google Places pricing must describe google_places_new text_search.");
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
    })) return { matches: [], requestCount: 0, usage: [] };

    const usage = this.usage(1);

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
      return this.emptySearch(usage);
    }

    if (!response.ok) return this.emptySearch(usage);

    let parsed: z.infer<typeof GoogleTextSearchResponseSchema>;
    try {
      parsed = GoogleTextSearchResponseSchema.parse(await response.json());
    } catch {
      return this.emptySearch(usage);
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
    }).sort((left, right) => right.resolutionConfidence - left.resolutionConfidence || left.providerPlaceId.localeCompare(right.providerPlaceId));
    return { matches, requestCount: 1, usage: [usage], ...(usage.estimatedCostUsd === null ? {} : { estimatedCostUsd: usage.estimatedCostUsd }) };
  }

  private usage(requests: number): ProviderUsage {
    return usageFor(this.pricing, {
      provider: this.name,
      operation: "text_search",
      requests,
      billableUnits: requests,
    });
  }

  private emptySearch(usage: ProviderUsage): PlaceSearchRun {
    return { matches: [], requestCount: usage.requests, usage: [usage], ...(usage.estimatedCostUsd === null ? {} : { estimatedCostUsd: usage.estimatedCostUsd }) };
  }

}
