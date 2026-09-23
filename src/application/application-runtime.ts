import { AnalysisApiService } from "./analysis-api-service.js";
import { BrowserSessionService } from "./browser-session-service.js";
import { SavedPlaceService } from "./saved-place-service.js";
import { AnalysisCache } from "../persistence/analysis-cache.js";
import { createDatabase, databaseUrlFromEnvironment } from "../persistence/database.js";
import { IdempotentOperation, requestHash } from "../persistence/idempotency.js";
import { DrizzlePersistenceRepository } from "../persistence/repositories.js";
import { NoGuessPlaceExtractor, OpenAIPlaceExtractor } from "../extraction/place-extractor.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { TikTokSource } from "../ingestion/tiktok-source.js";
import type { ProbeServerOptions } from "../http/probe-server.js";
import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { TypeSafeEvidenceJudge } from "../evidence/typesafe-evidence-judge.js";
import { GooglePlacesProvider } from "../resolution/google-places-provider.js";
import { EmptyPlaceProvider, PlaceResolver, type PlaceProvider } from "../resolution/place-resolver.js";

function optionalEnvironment(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

/** Creates the server-owned runtime used by both Next pages and route handlers. */
export function createApplicationRuntime(environment: NodeJS.ProcessEnv = process.env): ProbeServerOptions {
  const openAiApiKey = optionalEnvironment(environment, "OPENAI_API_KEY");
  const googleApiKey = optionalEnvironment(environment, "GOOGLE_MAPS_API_KEY");
  const placeProvider: PlaceProvider = googleApiKey
    ? new GooglePlacesProvider({ apiKey: googleApiKey })
    : new EmptyPlaceProvider();
  const analyzer = new AnalyzeSource(
    new ContentSourceRouter([new TikTokSource()]),
    openAiApiKey ? new OpenAIPlaceExtractor({ apiKey: openAiApiKey }) : new NoGuessPlaceExtractor(),
    new PlaceResolver(placeProvider),
    new TypeSafeEvidenceJudge({ apiKey: optionalEnvironment(environment, "TYPESAFE_API_KEY") }),
  );
  const runtime: ProbeServerOptions = {
    analyzer,
    probeToken: optionalEnvironment(environment, "PROBE_TOKEN"),
  };
  const apiToken = optionalEnvironment(environment, "API_TOKEN");
  const databaseUrl = optionalEnvironment(environment, "DATABASE_URL");
  if (!apiToken || !databaseUrl) return runtime;

  const database = createDatabase(databaseUrlFromEnvironment({ DATABASE_URL: databaseUrl }));
  const repository = new DrizzlePersistenceRepository(database.db);
  return {
    ...runtime,
    apiToken,
    analysisApi: new AnalysisApiService({
      analyzer,
      cache: new AnalysisCache(repository),
      idempotency: new IdempotentOperation(repository),
      userAnalyses: repository,
      pipelineVersion: "m2.4-tiktok-url-evidence-v1",
      providerConfigFingerprint: requestHash({
        source: "tiktok_oembed",
        extractor: openAiApiKey ? "openai" : "no_guess",
        placeProvider: googleApiKey ? "google_places_new" : "empty",
        evidenceJudge: optionalEnvironment(environment, "TYPESAFE_API_KEY") ? "typesafe_jev_1_13" : "unavailable",
      }),
    }),
    savedPlacesApi: new SavedPlaceService({ repository }),
    browserSessions: new BrowserSessionService(repository),
  };
}

let runtime: ProbeServerOptions | undefined;

export function getApplicationRuntime(): ProbeServerOptions {
  runtime ??= createApplicationRuntime();
  return runtime;
}
