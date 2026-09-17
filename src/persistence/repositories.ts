import { and, eq, lt, or } from "drizzle-orm";
import type { AnalysisResult } from "../domain/models.js";
import {
  cacheableSource,
  normalizeSubmittedUrl,
  providerUsageFromAnalysis,
  type AnalysisCacheKey,
  type AnalysisCacheRepository,
  type AnalysisCacheWrite,
  type CachedAnalysis,
} from "./analysis-cache.js";
import type {
  IdempotencyClaim,
  IdempotencyRepository,
  IdempotencyRequest,
  StoredIdempotencyResponse,
} from "./idempotency.js";
import type { SavePlaceDatabase } from "./database.js";
import { idempotencyOperations, sourceAliases, sourceAnalyses, sources, users } from "./schema.js";

type DatabaseClient = SavePlaceDatabase;

function requireCacheKey(key: AnalysisCacheKey): string {
  const normalized = normalizeSubmittedUrl(key.inputUrl);
  if (!normalized) throw new Error("A cache key requires a valid HTTPS input URL.");
  if (!key.pipelineVersion.trim()) throw new Error("pipelineVersion must be set.");
  if (!key.providerConfigFingerprint.trim()) throw new Error("providerConfigFingerprint must be set.");
  return normalized;
}

function requireIdempotencyRequest(request: IdempotencyRequest): void {
  if (!request.userId.trim() || request.userId.length > 128) throw new Error("userId must be 1-128 characters.");
  if (!request.idempotencyKey.trim() || request.idempotencyKey.length > 255) throw new Error("idempotencyKey must be 1-255 characters.");
  if (!request.requestHash.trim() || request.requestHash.length > 128) throw new Error("requestHash must be 1-128 characters.");
  if (Number.isNaN(request.expiresAt.getTime())) throw new Error("expiresAt must be a valid date.");
}

export class DrizzlePersistenceRepository implements AnalysisCacheRepository, IdempotencyRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findCachedAnalysis(key: AnalysisCacheKey): Promise<CachedAnalysis | undefined> {
    const normalizedUrl = requireCacheKey(key);
    const [cached] = await this.db
      .select({ analysisId: sourceAnalyses.id, sourceId: sourceAnalyses.sourceId, result: sourceAnalyses.result })
      .from(sourceAliases)
      .innerJoin(sourceAnalyses, eq(sourceAliases.sourceId, sourceAnalyses.sourceId))
      .where(and(
        eq(sourceAliases.normalizedUrl, normalizedUrl),
        eq(sourceAnalyses.pipelineVersion, key.pipelineVersion),
        eq(sourceAnalyses.providerConfigFingerprint, key.providerConfigFingerprint),
      ))
      .limit(1);
    return cached ? { ...cached, result: cached.result as AnalysisResult } : undefined;
  }

  async storeAnalysis(write: AnalysisCacheWrite): Promise<CachedAnalysis> {
    const normalizedInputUrl = requireCacheKey(write);
    const source = cacheableSource(write.result, normalizedInputUrl);
    if (!source) throw new Error("Only a recognized, valid source can be cached.");

    return this.db.transaction(async (tx) => {
      await tx
        .insert(sources)
        .values({
          platform: source.platform,
          canonicalUrl: source.canonicalUrl,
          ...(source.canonicalContentId ? { canonicalContentId: source.canonicalContentId } : {}),
          updatedAt: new Date(),
        })
        .onConflictDoNothing();
      const identity = source.canonicalContentId
        ? or(
          eq(sources.canonicalUrl, source.canonicalUrl),
          eq(sources.canonicalContentId, source.canonicalContentId),
        )
        : eq(sources.canonicalUrl, source.canonicalUrl);
      const [storedSource] = await tx
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.platform, source.platform), identity))
        .limit(1);
      if (!storedSource) throw new Error("Unable to persist source identity.");

      await tx.update(sources)
        .set({
          ...(source.canonicalContentId ? { canonicalContentId: source.canonicalContentId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(sources.id, storedSource.id));

      const aliases = new Map<string, string>([
        [normalizedInputUrl, write.inputUrl],
        [source.canonicalUrl, source.canonicalUrl],
      ]);
      for (const [normalizedUrl, originalUrl] of aliases) {
        await tx.insert(sourceAliases).values({ sourceId: storedSource.id, normalizedUrl, originalUrl })
          .onConflictDoUpdate({
            target: sourceAliases.normalizedUrl,
            set: { sourceId: storedSource.id, originalUrl },
          });
      }

      const [analysis] = await tx
        .insert(sourceAnalyses)
        .values({
          sourceId: storedSource.id,
          pipelineVersion: write.pipelineVersion,
          providerConfigFingerprint: write.providerConfigFingerprint,
          status: write.result.status,
          result: write.result,
          providerUsage: providerUsageFromAnalysis(write.result),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [sourceAnalyses.sourceId, sourceAnalyses.pipelineVersion, sourceAnalyses.providerConfigFingerprint],
          set: {
            status: write.result.status,
            result: write.result,
            providerUsage: providerUsageFromAnalysis(write.result),
            updatedAt: new Date(),
          },
        })
        .returning({ id: sourceAnalyses.id });
      if (!analysis) throw new Error("Unable to persist analysis cache entry.");
      return { analysisId: analysis.id, sourceId: storedSource.id, result: write.result };
    });
  }

  async claim(request: IdempotencyRequest): Promise<IdempotencyClaim> {
    requireIdempotencyRequest(request);
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.delete(idempotencyOperations).where(and(
        eq(idempotencyOperations.userId, request.userId),
        eq(idempotencyOperations.idempotencyKey, request.idempotencyKey),
        lt(idempotencyOperations.expiresAt, now),
      ));
      await tx.insert(users).values({ id: request.userId }).onConflictDoNothing();
      const [created] = await tx
        .insert(idempotencyOperations)
        .values({
          userId: request.userId,
          idempotencyKey: request.idempotencyKey,
          requestHash: request.requestHash,
          state: "processing",
          expiresAt: request.expiresAt,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyOperations.id });
      if (created) return { state: "started", operationId: created.id };

      const [existing] = await tx
        .select()
        .from(idempotencyOperations)
        .where(and(
          eq(idempotencyOperations.userId, request.userId),
          eq(idempotencyOperations.idempotencyKey, request.idempotencyKey),
        ))
        .limit(1);
      if (!existing) throw new Error("Unable to claim idempotency operation.");
      if (existing.requestHash !== request.requestHash) return { state: "conflict", operationId: existing.id };
      if (existing.state === "processing") return { state: "in_progress", operationId: existing.id };
      if (existing.responseStatus === null || !existing.responseBody) {
        return { state: "in_progress", operationId: existing.id };
      }
      return {
        state: "replay",
        operationId: existing.id,
        response: { responseStatus: existing.responseStatus, responseBody: existing.responseBody },
      };
    });
  }

  async complete(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> {
    await this.finish(request, "completed", response);
  }

  async fail(request: IdempotencyRequest, response: StoredIdempotencyResponse): Promise<void> {
    await this.finish(request, "failed", response);
  }

  private async finish(request: IdempotencyRequest, state: "completed" | "failed", response: StoredIdempotencyResponse): Promise<void> {
    requireIdempotencyRequest(request);
    const updated = await this.db
      .update(idempotencyOperations)
      .set({ state, responseStatus: response.responseStatus, responseBody: response.responseBody, updatedAt: new Date() })
      .where(and(
        eq(idempotencyOperations.userId, request.userId),
        eq(idempotencyOperations.idempotencyKey, request.idempotencyKey),
        eq(idempotencyOperations.requestHash, request.requestHash),
        eq(idempotencyOperations.state, "processing"),
      ))
      .returning({ id: idempotencyOperations.id });
    if (!updated[0]) throw new Error("The idempotency operation is not processing for this request.");
  }
}
