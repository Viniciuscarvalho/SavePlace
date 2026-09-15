import type { AnalysisResult, Platform } from "../domain/models.js";
import type { ContentSourceRouter } from "../ingestion/content-source.js";
import type { PlaceExtractor } from "../extraction/place-extractor.js";
import type { PlaceResolver } from "../resolution/place-resolver.js";

export class AnalyzeSource {
  constructor(
    private readonly sources: ContentSourceRouter,
    private readonly extractor: PlaceExtractor,
    private readonly resolver: PlaceResolver,
  ) {}

  async execute(input: string): Promise<AnalysisResult> {
    const startedAt = performance.now();
    const acquisition = await this.sources.acquire(input);

    if (acquisition.status === "media_required") {
      return {
        status: "media_required",
        source: { input, platform: acquisition.platform },
        candidates: [],
        places: [],
        processing: { extractionMethod: "none", durationMs: performance.now() - startedAt },
        reason: acquisition.reason,
        nextAction: acquisition.nextAction,
      };
    }

    if (acquisition.status === "unsupported") {
      return {
        status: "failed",
        source: { input, platform: "unknown" },
        candidates: [],
        places: [],
        processing: { extractionMethod: "none", durationMs: performance.now() - startedAt },
        reason: acquisition.reason,
      };
    }

    const candidates = await this.extractor.extract(acquisition.source);
    const resolved = await Promise.all(candidates.map((candidate) => this.resolver.resolve(candidate)));
    const places = resolved.filter((place): place is NonNullable<typeof place> => place !== null);

    const method = acquisition.source.transcript ? "transcript" : "metadata";
    const status = candidates.length > 0 && places.length === candidates.length ? "completed" : "needs_review";

    return {
      status,
      source: { input, platform: acquisition.source.platform as Platform },
      candidates,
      places,
      processing: { extractionMethod: method, durationMs: performance.now() - startedAt },
      ...(status === "needs_review" ? { nextAction: "review" as const } : {}),
    };
  }
}
