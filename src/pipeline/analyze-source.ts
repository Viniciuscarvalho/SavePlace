import type { AnalysisResult } from "../domain/models.js";
import type { ContentSourceRouter } from "../ingestion/content-source.js";
import type { AuditablePlaceExtractor, ExtractionRun, PlaceExtractor } from "../extraction/place-extractor.js";
import type { PlaceResolver } from "../resolution/place-resolver.js";

export class AnalyzeSource {
  constructor(private readonly sources: ContentSourceRouter, private readonly extractor: PlaceExtractor, private readonly resolver: PlaceResolver) {}

  async execute(input: string): Promise<AnalysisResult> {
    const startedAt = performance.now();
    const acquisition = await this.sources.acquire(input);

    if (acquisition.status === "insufficient_evidence") {
      return {
        status: "insufficient_evidence",
        source: { input, platform: acquisition.platform, ...(acquisition.canonicalUrl ? { canonicalUrl: acquisition.canonicalUrl } : {}) },
        evidence: [], candidates: [], places: [],
        processing: { extractionMethod: "none", durationMs: performance.now() - startedAt },
        reason: acquisition.reason,
      };
    }

    if (acquisition.status === "unsupported") {
      return {
        status: "failed", source: { input, platform: "unknown" }, evidence: [], candidates: [], places: [],
        processing: { extractionMethod: "none", durationMs: performance.now() - startedAt }, reason: acquisition.reason,
      };
    }

    const extraction = await this.extract(acquisition.source);
    const candidates = extraction.candidates;
    const resolved = await Promise.all(candidates.map((candidate) => this.resolver.resolve(candidate)));
    const places = resolved.filter((place): place is NonNullable<typeof place> => place !== null);
    const status = candidates.length > 0 && places.length === candidates.length ? "completed" : "needs_review";

    return {
      status,
      source: { input, platform: acquisition.source.platform, canonicalUrl: acquisition.source.canonicalUrl, ...(acquisition.source.contentId ? { contentId: acquisition.source.contentId } : {}) },
      evidence: acquisition.source.evidence,
      candidates, places,
      processing: {
        extractionMethod: "url_metadata",
        durationMs: performance.now() - startedAt,
        ...(extraction.trace ? { extraction: extraction.trace } : {}),
      },
      ...(extraction.trace?.status === "unavailable" ? { reason: "The configured extraction provider is unavailable." } : {}),
      ...(extraction.trace?.status === "failed" ? { reason: "The extraction provider could not produce a valid candidate set." } : {}),
      ...(status === "needs_review" ? { nextAction: "review" as const } : {}),
    };
  }

  private async extract(source: Parameters<PlaceExtractor["extract"]>[0]): Promise<{ candidates: Awaited<ReturnType<PlaceExtractor["extract"]>>; trace?: ExtractionRun["attribution"] & Pick<ExtractionRun, "status"> }> {
    if (this.isAuditable(this.extractor)) {
      const run = await this.extractor.extractWithTrace(source);
      return { candidates: run.candidates, trace: { status: run.status, ...run.attribution } };
    }
    return { candidates: await this.extractor.extract(source) };
  }

  private isAuditable(extractor: PlaceExtractor): extractor is AuditablePlaceExtractor {
    return "extractWithTrace" in extractor && typeof extractor.extractWithTrace === "function";
  }
}
