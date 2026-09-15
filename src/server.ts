import { AnalyzeSource } from "./pipeline/analyze-source.js";
import { NoGuessPlaceExtractor } from "./extraction/place-extractor.js";
import { ContentSourceRouter } from "./ingestion/content-source.js";
import { TikTokSource } from "./ingestion/tiktok-source.js";
import { createProbeServer } from "./http/probe-server.js";
import { EmptyPlaceProvider, PlaceResolver } from "./resolution/place-resolver.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set.`);
  return value;
}

function portFromEnvironment(): number {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
  return port;
}

const analyzer = new AnalyzeSource(
  new ContentSourceRouter([new TikTokSource()]),
  new NoGuessPlaceExtractor(),
  new PlaceResolver(new EmptyPlaceProvider()),
);

const server = createProbeServer({ analyzer, probeToken: requiredEnvironment("PROBE_TOKEN") });
const port = portFromEnvironment();

server.listen(port, "0.0.0.0", () => {
  console.log(`SavePlace Railway probe listening on port ${port}.`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
