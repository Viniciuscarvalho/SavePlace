import { AnalyzeSource } from "./pipeline/analyze-source.js";
import { NoGuessPlaceExtractor, OpenAIPlaceExtractor } from "./extraction/place-extractor.js";
import { ContentSourceRouter } from "./ingestion/content-source.js";
import { TikTokSource } from "./ingestion/tiktok-source.js";
import { createProbeServer } from "./http/probe-server.js";
import { EmptyPlaceProvider, PlaceResolver, type PlaceProvider } from "./resolution/place-resolver.js";
import { GooglePlacesProvider } from "./resolution/google-places-provider.js";
import { createDatabase, databaseUrlFromEnvironment } from "./persistence/database.js";
import { DrizzlePersistenceRepository } from "./persistence/repositories.js";
import { AnalysisCache } from "./persistence/analysis-cache.js";
import { IdempotentOperation, requestHash } from "./persistence/idempotency.js";
import { AnalysisApiService } from "./application/analysis-api-service.js";
import { SavedPlaceService } from "./application/saved-place-service.js";

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function portFromEnvironment(): number {
  const rawPort = process.env.PORT ?? "3000";
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("PORT must be a valid TCP port.");
  return port;
}

const openAiApiKey = optionalEnvironment("OPENAI_API_KEY");
const googleApiKey = optionalEnvironment("GOOGLE_MAPS_API_KEY");
const placeProvider: PlaceProvider = googleApiKey
  ? new GooglePlacesProvider({ apiKey: googleApiKey })
  : new EmptyPlaceProvider();
const analyzer = new AnalyzeSource(
  new ContentSourceRouter([new TikTokSource()]),
  openAiApiKey ? new OpenAIPlaceExtractor({ apiKey: openAiApiKey }) : new NoGuessPlaceExtractor(),
  new PlaceResolver(placeProvider),
);

function createAnalysisApi(): {
  token: string;
  analysisService: AnalysisApiService;
  savedPlacesService: SavedPlaceService;
  close: () => Promise<void>;
} | undefined {
  const apiToken = optionalEnvironment("API_TOKEN");
  const ownerUserId = optionalEnvironment("SAVEPLACE_OWNER_ID");
  const databaseUrl = optionalEnvironment("DATABASE_URL");
  if (!apiToken || !ownerUserId || !databaseUrl) return undefined;

  const database = createDatabase(databaseUrlFromEnvironment({ DATABASE_URL: databaseUrl }));
  const repository = new DrizzlePersistenceRepository(database.db);
  return {
    token: apiToken,
    analysisService: new AnalysisApiService({
      analyzer,
      cache: new AnalysisCache(repository),
      idempotency: new IdempotentOperation(repository),
      ownerUserId,
      pipelineVersion: "m1.4b-tiktok-url-v1",
      providerConfigFingerprint: requestHash({
        source: "tiktok_oembed",
        extractor: openAiApiKey ? "openai" : "no_guess",
        placeProvider: googleApiKey ? "google_places_new" : "empty",
      }),
    }),
    savedPlacesService: new SavedPlaceService({ repository, ownerUserId }),
    close: database.close,
  };
}

// The health endpoint must remain available so Railway can report a clear
// configuration failure. The authenticated probe itself stays disabled until
// its secret is present.
const analysisApi = createAnalysisApi();
const server = createProbeServer({
  analyzer,
  probeToken: optionalEnvironment("PROBE_TOKEN"),
  ...(analysisApi ? {
    apiToken: analysisApi.token,
    analysisApi: analysisApi.analysisService,
    savedPlacesApi: analysisApi.savedPlacesService,
  } : {}),
});
const port = portFromEnvironment();
const probeConfigured = optionalEnvironment("PROBE_TOKEN") !== undefined;

server.listen(port, "0.0.0.0", () => {
  console.log(`SavePlace server listening on port ${port}. PROBE_TOKEN configured: ${probeConfigured ? "yes" : "no"}. Analysis API configured: ${analysisApi ? "yes" : "no"}.`);
});

function shutdown(): void {
  server.close(() => {
    if (!analysisApi) {
      process.exit(0);
      return;
    }
    void analysisApi.close().finally(() => process.exit(0));
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
