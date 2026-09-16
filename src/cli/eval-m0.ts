import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenAIPlaceExtractor } from "../extraction/place-extractor.js";
import { ContentSourceRouter } from "../ingestion/content-source.js";
import { TikTokSource } from "../ingestion/tiktok-source.js";
import { AnalyzeSource } from "../pipeline/analyze-source.js";
import { GooglePlacesProvider } from "../resolution/google-places-provider.js";
import { PlaceResolver } from "../resolution/place-resolver.js";
import type { ProviderPricing } from "../resolution/pricing.js";
import { loadEvaluationCases, runFixtureEvaluation, runLiveEvaluation } from "../evaluation/runner.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const casesDirectory = path.join(root, "evals/cases");
const fixturesDirectory = path.join(root, "evals/fixtures");
const resultsDirectory = path.join(root, "evals/results");
const live = process.argv.includes("--live");

function optionalNonNegativeNumber(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number when set.`);
  return parsed;
}

function googleTextSearchPricing(): ProviderPricing | undefined {
  const pricePerUnitUsd = optionalNonNegativeNumber("GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD");
  if (pricePerUnitUsd === undefined) return undefined;
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

const cases = await loadEvaluationCases(casesDirectory);
let report;
if (live) {
  if (process.env.RUN_M0_EVAL_LIVE !== "1") throw new Error("Set RUN_M0_EVAL_LIVE=1 before running the paid live evaluation.");
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!openAiApiKey || !googleApiKey) throw new Error("OPENAI_API_KEY and GOOGLE_MAPS_API_KEY must both be set for the live evaluation.");
  const pricing = googleTextSearchPricing();
  const pipeline = new AnalyzeSource(
    new ContentSourceRouter([new TikTokSource()]),
    new OpenAIPlaceExtractor({ apiKey: openAiApiKey }),
    new PlaceResolver(new GooglePlacesProvider({
      apiKey: googleApiKey,
      ...(pricing === undefined
        ? {}
        : { pricing }),
    })),
  );
  report = await runLiveEvaluation(cases, (input) => pipeline.execute(input));
} else {
  report = await runFixtureEvaluation(cases, fixturesDirectory);
}

await mkdir(resultsDirectory, { recursive: true });
const filename = live ? "m0-live.json" : "m0-fixtures.json";
await writeFile(path.join(resultsDirectory, filename), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--gate") && !report.gate.ready) process.exitCode = 1;
