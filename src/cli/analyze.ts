import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { TikTokSource } from "../ingestion/tiktok-source.js";
import { OpenAIPlaceExtractor } from "../extraction/place-extractor.js";
import { GooglePlacesProvider } from "../resolution/google-places-provider.js";
import { EmptyPlaceProvider, PlaceResolver, type PlaceProvider } from "../resolution/place-resolver.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run analyze -- <social-url>");
  process.exitCode = 1;
} else {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const placeProvider: PlaceProvider = googleApiKey ? new GooglePlacesProvider({ apiKey: googleApiKey }) : new EmptyPlaceProvider();
  const pipeline = new AnalyzeSource(
    new ContentSourceRouter([new TikTokSource()]),
    new OpenAIPlaceExtractor(process.env.OPENAI_API_KEY?.trim() ? { apiKey: process.env.OPENAI_API_KEY } : {}),
    new PlaceResolver(placeProvider),
  );
  console.log(JSON.stringify(await pipeline.execute(input), null, 2));
}
