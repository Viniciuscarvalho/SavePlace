import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { YouTubeSource } from "../ingestion/youtube-source.js";
import { NoGuessPlaceExtractor } from "../extraction/place-extractor.js";
import { EmptyPlaceProvider, PlaceResolver } from "../resolution/place-resolver.js";

const input = process.argv[2];

if (!input) {
  console.error("Usage: npm run analyze -- <social-url-or-media-path>");
  process.exitCode = 1;
} else {
  const pipeline = new AnalyzeSource(
    new ContentSourceRouter([new YouTubeSource()]),
    new NoGuessPlaceExtractor(),
    new PlaceResolver(new EmptyPlaceProvider()),
  );

  const result = await pipeline.execute(input);
  console.log(JSON.stringify(result, null, 2));
}
