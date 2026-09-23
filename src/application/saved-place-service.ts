export type SavedPlaceStatus = "want_to_go" | "visited";

/**
 * The persisted geographic identity. It is only returned by a repository after
 * joining an analysis mention to a provider-verified `places` row.
 */
export type VerifiedAnalysisPlace = {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  provider: string;
  providerPlaceId: string;
};

export type AnalysisPlaceLookup =
  | { status: "verified"; place: VerifiedAnalysisPlace }
  | { status: "unverified" };

export type SavedPlace = VerifiedAnalysisPlace & {
  userPlaceId: string;
  status: SavedPlaceStatus;
  favorite: boolean;
  notes?: string;
};

export type SavedPlaceUpdate = {
  status?: SavedPlaceStatus | undefined;
  favorite?: boolean | undefined;
  notes?: string | null | undefined;
};

/**
 * This repository boundary deliberately owns the SQL proof that a place belongs
 * to an analysis through `place_mentions`. The application service never trusts
 * an arbitrary place ID submitted by a client.
 */
export interface SavedPlaceRepository {
  findAnalysisPlace(userId: string, analysisId: string, placeId: string): Promise<AnalysisPlaceLookup | undefined>;
  upsertUserPlace(userId: string, place: VerifiedAnalysisPlace): Promise<SavedPlace>;
  listUserPlaces(userId: string): Promise<SavedPlace[]>;
  updateUserPlace(userId: string, userPlaceId: string, update: SavedPlaceUpdate): Promise<SavedPlace | undefined>;
  deleteUserPlace(userId: string, userPlaceId: string): Promise<boolean>;
}

export class AnalysisPlaceNotFoundError extends Error {
  constructor() {
    super("The requested place is not associated with this analysis.");
  }
}

export class AnalysisPlaceUnverifiedError extends Error {
  constructor() {
    super("Only a provider-verified place can be saved.");
  }
}

export class SavedPlaceNotFoundError extends Error {
  constructor() {
    super("The requested saved place was not found.");
  }
}

export class SavedPlaceService {
  constructor(
    private readonly options: {
      repository: SavedPlaceRepository;
    },
  ) {}

  async confirm(userId: string, analysisId: string, placeId: string): Promise<SavedPlace> {
    requireUserId(userId);
    const analysisPlace = await this.options.repository.findAnalysisPlace(userId, analysisId, placeId);
    if (!analysisPlace) throw new AnalysisPlaceNotFoundError();
    if (analysisPlace.status !== "verified") throw new AnalysisPlaceUnverifiedError();

    return this.options.repository.upsertUserPlace(userId, analysisPlace.place);
  }

  async list(userId: string): Promise<SavedPlace[]> {
    requireUserId(userId);
    return this.options.repository.listUserPlaces(userId);
  }

  async update(userId: string, userPlaceId: string, update: SavedPlaceUpdate): Promise<SavedPlace> {
    requireUserId(userId);
    if (!userPlaceId.trim() || userPlaceId.length > 128) throw new Error("userPlaceId must be 1-128 characters.");
    const savedPlace = await this.options.repository.updateUserPlace(userId, userPlaceId, normalizeUpdate(update));
    if (!savedPlace) throw new SavedPlaceNotFoundError();
    return savedPlace;
  }

  async remove(userId: string, userPlaceId: string): Promise<void> {
    requireUserId(userId);
    if (!userPlaceId.trim() || userPlaceId.length > 128) throw new Error("userPlaceId must be 1-128 characters.");
    if (!await this.options.repository.deleteUserPlace(userId, userPlaceId)) throw new SavedPlaceNotFoundError();
  }
}

function requireUserId(userId: string): void {
  if (!userId.trim() || userId.length > 128) throw new Error("userId must be 1-128 characters.");
}

function normalizeUpdate(update: SavedPlaceUpdate): SavedPlaceUpdate {
  const normalized: SavedPlaceUpdate = {};
  if (update.status !== undefined) {
    if (update.status !== "want_to_go" && update.status !== "visited") throw new Error("status must be want_to_go or visited.");
    normalized.status = update.status;
  }
  if (update.favorite !== undefined) {
    if (typeof update.favorite !== "boolean") throw new Error("favorite must be a boolean.");
    normalized.favorite = update.favorite;
  }
  if (update.notes !== undefined) {
    if (update.notes !== null && typeof update.notes !== "string") throw new Error("notes must be a string or null.");
    const notes = typeof update.notes === "string" ? update.notes.trim() : null;
    if (notes && notes.length > 2_000) throw new Error("notes must be at most 2000 characters.");
    normalized.notes = notes;
  }
  if (Object.keys(normalized).length === 0) throw new Error("At least one saved place field must be set.");
  return normalized;
}
