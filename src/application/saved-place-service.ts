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

/**
 * This repository boundary deliberately owns the SQL proof that a place belongs
 * to an analysis through `place_mentions`. The application service never trusts
 * an arbitrary place ID submitted by a client.
 */
export interface SavedPlaceRepository {
  findAnalysisPlace(userId: string, analysisId: string, placeId: string): Promise<AnalysisPlaceLookup | undefined>;
  upsertUserPlace(userId: string, place: VerifiedAnalysisPlace): Promise<SavedPlace>;
  listUserPlaces(userId: string): Promise<SavedPlace[]>;
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

export class SavedPlaceService {
  constructor(
    private readonly options: {
      repository: SavedPlaceRepository;
    },
  ) {}

  async confirm(userId: string, analysisId: string, placeId: string): Promise<SavedPlace> {
    if (!userId.trim() || userId.length > 128) throw new Error("userId must be 1-128 characters.");
    const analysisPlace = await this.options.repository.findAnalysisPlace(userId, analysisId, placeId);
    if (!analysisPlace) throw new AnalysisPlaceNotFoundError();
    if (analysisPlace.status !== "verified") throw new AnalysisPlaceUnverifiedError();

    return this.options.repository.upsertUserPlace(userId, analysisPlace.place);
  }

  async list(userId: string): Promise<SavedPlace[]> {
    if (!userId.trim() || userId.length > 128) throw new Error("userId must be 1-128 characters.");
    return this.options.repository.listUserPlaces(userId);
  }
}
