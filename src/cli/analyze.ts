import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { TikTokSource } from "../ingestion/tiktok-source.js";
import { NoGuessPlaceExtractor } from "../extraction/place-extractor.js";
import { EmptyPlaceProvider, PlaceResolver } from "../resolution/place-resolver.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: npm run analyze -- <social-url>");
  process.exitCode = 1;
} else {
  const pipeline = new AnalyzeSource(
    new ContentSourceRouter([new TikTokSource()]),
    new NoGuessPlaceExtractor(),
    new PlaceResolver(new EmptyPlaceProvider()),
  );
  console.log(JSON.stringify(await pipeline.execute(input), null, 2));
}
