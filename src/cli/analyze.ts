import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { TikTokSource } from "../ingestion/tiktok-source.js";
import { OpenAIPlaceExtractor } from "../extraction/place-extractor.js";
import { GooglePlacesProvider } from "../resolution/google-places-provider.js";
import { EmptyPlaceProvider, PlaceResolver, type PlaceProvider } from "../resolution/place-resolver.js";
import type { ProviderPricing } from "../resolution/pricing.js";

function googleTextSearchPricing(): ProviderPricing | undefined {
  const rawPrice = process.env.GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD?.trim();
  if (!rawPrice) return undefined;
  const pricePerUnitUsd = Number(rawPrice);
  if (!Number.isFinite(pricePerUnitUsd) || pricePerUnitUsd < 0) {
    throw new Error("GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD must be a non-negative number when set.");
  }
  const source = process.env.GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE?.trim();
  const effectiveDate = process.env.GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE?.trim();
  return {
    provider: "google_places_new",
    operation: "text_search",
    pricePerUnitUsd,
    ...(source ? { source } : {}),
    ...(effectiveDate ? { effectiveDate } : {}),
  };
}

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run analyze -- <social-url>");
  process.exitCode = 1;
} else {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const pricing = googleTextSearchPricing();
  const placeProvider: PlaceProvider = googleApiKey ? new GooglePlacesProvider({ apiKey: googleApiKey, ...(pricing ? { pricing } : {}) }) : new EmptyPlaceProvider();
  const pipeline = new AnalyzeSource(
    new ContentSourceRouter([new TikTokSource()]),
    new OpenAIPlaceExtractor(process.env.OPENAI_API_KEY?.trim() ? { apiKey: process.env.OPENAI_API_KEY } : {}),
    new PlaceResolver(placeProvider),
  );
  console.log(JSON.stringify(await pipeline.execute(input), null, 2));
}
