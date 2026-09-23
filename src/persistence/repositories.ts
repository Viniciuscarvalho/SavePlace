import { and, eq, gt, lt, or } from "drizzle-orm";
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
import { mentionsForPersistence, providerPlaceIdentity, verifiedPlacesForPersistence } from "./analysis-place-persistence.js";
import { idempotencyOperations, placeMentions, places, sessions, sourceAliases, sourceAnalyses, sources, userAnalyses, userPlaces, users } from "./schema.js";
import type {
  AnalysisPlaceLookup,
  SavedPlace as UserSavedPlace,
  SavedPlaceUpdate,
  SavedPlaceRepository,
  VerifiedAnalysisPlace,
} from "../application/saved-place-service.js";
import type { BrowserSessionRecord, BrowserSessionRepository } from "../application/browser-session-service.js";
import type { UserAnalysisRepository } from "../application/analysis-api-service.js";

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

function decimal(value: number, scale: number, label: string): string {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
  return value.toFixed(scale);
}

function persistedPlaceId(provider: string, providerPlaceId: string, ids: ReadonlyMap<string, string>): string {
  const id = ids.get(`${provider}:${providerPlaceId}`);
  if (!id) throw new Error("Unable to link a verified place mention.");
  return id;
}

export class DrizzlePersistenceRepository implements AnalysisCacheRepository, IdempotencyRepository, SavedPlaceRepository, BrowserSessionRepository, UserAnalysisRepository {
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
    if (!cached) return undefined;
    return {
      ...cached,
      result: cached.result as AnalysisResult,
      verifiedPlaceReferences: await this.verifiedPlaceReferences(cached.analysisId),
    };
  }

  async findSessionUserId(tokenHash: string, now: Date): Promise<string | undefined> {
    const [session] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
      .limit(1);
    return session?.userId;
  }

  async createSession(session: BrowserSessionRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: session.userId }).onConflictDoNothing();
      await tx.insert(sessions).values({
        userId: session.userId,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
      });
    });
  }

  async linkUserToAnalysis(userId: string, analysisId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId }).onConflictDoNothing();
      await tx
        .insert(userAnalyses)
        .values({ userId, analysisId })
        .onConflictDoNothing();
    });
  }

  async findAnalysisForUser(userId: string, analysisId: string): Promise<CachedAnalysis | undefined> {
    const [analysis] = await this.db
      .select({ analysisId: sourceAnalyses.id, sourceId: sourceAnalyses.sourceId, result: sourceAnalyses.result })
      .from(userAnalyses)
      .innerJoin(sourceAnalyses, eq(userAnalyses.analysisId, sourceAnalyses.id))
      .where(and(eq(userAnalyses.userId, userId), eq(userAnalyses.analysisId, analysisId)))
      .limit(1);
    if (!analysis) return undefined;
    return {
      ...analysis,
      result: analysis.result as AnalysisResult,
      verifiedPlaceReferences: await this.verifiedPlaceReferences(analysis.analysisId),
    };
  }

  async storeAnalysis(write: AnalysisCacheWrite): Promise<CachedAnalysis> {
    const normalizedInputUrl = requireCacheKey(write);
    const source = cacheableSource(write.result, normalizedInputUrl);
    if (!source) throw new Error("Only a recognized, valid source can be cached.");

    const stored = await this.db.transaction(async (tx) => {
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

      const mentions = mentionsForPersistence(write.result);
      const storedPlaceIds = new Map<string, string>();
      for (const place of verifiedPlacesForPersistence(mentions)) {
        const [storedPlace] = await tx
          .insert(places)
          .values({
            name: place.name,
            normalizedName: place.normalizedName,
            category: place.category,
            ...(place.subcategory ? { subcategory: place.subcategory } : {}),
            address: place.address,
            city: place.city,
            ...(place.state ? { state: place.state } : {}),
            country: place.country,
            latitude: decimal(place.latitude, 7, "latitude"),
            longitude: decimal(place.longitude, 7, "longitude"),
            provider: place.provider,
            providerPlaceId: place.providerPlaceId,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [places.provider, places.providerPlaceId],
            set: {
              name: place.name,
              normalizedName: place.normalizedName,
              category: place.category,
              subcategory: place.subcategory,
              address: place.address,
              city: place.city,
              state: place.state,
              country: place.country,
              latitude: decimal(place.latitude, 7, "latitude"),
              longitude: decimal(place.longitude, 7, "longitude"),
              updatedAt: new Date(),
            },
          })
          .returning({ id: places.id });
        if (!storedPlace) throw new Error("Unable to persist verified place.");
        storedPlaceIds.set(providerPlaceIdentity(place), storedPlace.id);
      }

      // An analysis cache refresh replaces its derived links atomically. It does
      // not touch user_places: saving to a user's library remains an explicit
      // confirmation in the next M1.4 slice.
      await tx.delete(placeMentions).where(eq(placeMentions.analysisId, analysis.id));
      if (mentions.length > 0) {
        await tx.insert(placeMentions).values(mentions.map((mention) => ({
          analysisId: analysis.id,
          ...(mention.place ? { placeId: persistedPlaceId(mention.place.provider, mention.place.providerPlaceId, storedPlaceIds) } : {}),
          candidate: mention.candidate,
          evidence: mention.evidence,
          extractionConfidence: decimal(mention.candidate.extractionConfidence, 3, "extractionConfidence"),
          ...(mention.place ? {
            resolutionConfidence: decimal(mention.place.resolutionConfidence, 3, "resolutionConfidence"),
            overallConfidence: decimal(mention.place.overallConfidence, 3, "overallConfidence"),
          } : {}),
        })));
      }
      return { analysisId: analysis.id, sourceId: storedSource.id, result: write.result };
    });
    return { ...stored, verifiedPlaceReferences: await this.verifiedPlaceReferences(stored.analysisId) };
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

  async findAnalysisPlace(userId: string, analysisId: string, placeId: string): Promise<AnalysisPlaceLookup | undefined> {
    const [row] = await this.db
      .select(verifiedPlaceSelection)
      .from(userAnalyses)
      .innerJoin(placeMentions, eq(userAnalyses.analysisId, placeMentions.analysisId))
      .innerJoin(places, eq(placeMentions.placeId, places.id))
      .where(and(
        eq(userAnalyses.userId, userId),
        eq(userAnalyses.analysisId, analysisId),
        eq(placeMentions.placeId, placeId),
      ))
      .limit(1);
    return row ? { status: "verified", place: toVerifiedAnalysisPlace(row) } : undefined;
  }

  async upsertUserPlace(userId: string, place: VerifiedAnalysisPlace): Promise<UserSavedPlace> {
    if (!userId.trim()) throw new Error("userId must be set.");
    return this.db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId }).onConflictDoNothing();
      await tx
        .insert(userPlaces)
        .values({ userId, placeId: place.id, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: [userPlaces.userId, userPlaces.placeId],
          set: { updatedAt: new Date() },
        });
      return this.readUserPlace(tx, userId, place.id);
    });
  }

  async listUserPlaces(userId: string): Promise<UserSavedPlace[]> {
    if (!userId.trim()) throw new Error("userId must be set.");
    const rows = await this.db
      .select(userPlaceSelection)
      .from(userPlaces)
      .innerJoin(places, eq(userPlaces.placeId, places.id))
      .where(eq(userPlaces.userId, userId))
      .orderBy(userPlaces.createdAt);
    return rows.map(toUserSavedPlace);
  }

  async updateUserPlace(userId: string, userPlaceId: string, update: SavedPlaceUpdate): Promise<UserSavedPlace | undefined> {
    if (!userId.trim()) throw new Error("userId must be set.");
    const [updated] = await this.db
      .update(userPlaces)
      .set({
        ...(update.status !== undefined ? { status: update.status } : {}),
        ...(update.favorite !== undefined ? { favorite: update.favorite } : {}),
        ...(update.notes !== undefined ? { notes: update.notes } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(userPlaces.id, userPlaceId), eq(userPlaces.userId, userId)))
      .returning({ placeId: userPlaces.placeId });
    return updated ? this.readUserPlace(this.db, userId, updated.placeId) : undefined;
  }

  async deleteUserPlace(userId: string, userPlaceId: string): Promise<boolean> {
    if (!userId.trim()) throw new Error("userId must be set.");
    const deleted = await this.db
      .delete(userPlaces)
      .where(and(eq(userPlaces.id, userPlaceId), eq(userPlaces.userId, userId)))
      .returning({ id: userPlaces.id });
    return deleted.length === 1;
  }

  private async readUserPlace(tx: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0] | DatabaseClient, userId: string, placeId: string): Promise<UserSavedPlace> {
    const [row] = await tx
      .select(userPlaceSelection)
      .from(userPlaces)
      .innerJoin(places, eq(userPlaces.placeId, places.id))
      .where(and(eq(userPlaces.userId, userId), eq(userPlaces.placeId, placeId)))
      .limit(1);
    if (!row) throw new Error("Unable to persist user place.");
    return toUserSavedPlace(row);
  }

  private async verifiedPlaceReferences(analysisId: string): Promise<CachedAnalysis["verifiedPlaceReferences"]> {
    return this.db
      .select({ placeId: places.id, provider: places.provider, providerPlaceId: places.providerPlaceId })
      .from(placeMentions)
      .innerJoin(places, eq(placeMentions.placeId, places.id))
      .where(eq(placeMentions.analysisId, analysisId));
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

const verifiedPlaceSelection = {
  id: places.id,
  name: places.name,
  address: places.address,
  city: places.city,
  country: places.country,
  provider: places.provider,
  providerPlaceId: places.providerPlaceId,
};

const userPlaceSelection = {
  userPlaceId: userPlaces.id,
  status: userPlaces.status,
  favorite: userPlaces.favorite,
  notes: userPlaces.notes,
  id: places.id,
  name: places.name,
  address: places.address,
  city: places.city,
  country: places.country,
  provider: places.provider,
  providerPlaceId: places.providerPlaceId,
};

function toVerifiedAnalysisPlace(row: typeof verifiedPlaceSelection extends infer _Selection ? {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  provider: string;
  providerPlaceId: string;
} : never): VerifiedAnalysisPlace {
  return row;
}

function toUserSavedPlace(row: typeof userPlaceSelection extends infer _Selection ? {
  userPlaceId: string;
  status: "want_to_go" | "visited";
  favorite: boolean;
  notes: string | null;
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  provider: string;
  providerPlaceId: string;
} : never): UserSavedPlace {
  return {
    userPlaceId: row.userPlaceId,
    id: row.id,
    status: row.status,
    favorite: row.favorite,
    ...(row.notes ? { notes: row.notes } : {}),
    name: row.name,
    address: row.address,
    city: row.city,
    country: row.country,
    provider: row.provider,
    providerPlaceId: row.providerPlaceId,
  };
}
