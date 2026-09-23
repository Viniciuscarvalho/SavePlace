import { describe, expect, it, vi } from "vitest";
import {
  AnalysisPlaceNotFoundError,
  AnalysisPlaceUnverifiedError,
  SavedPlaceService,
  type AnalysisPlaceLookup,
  type SavedPlace,
  type SavedPlaceUpdate,
  type SavedPlaceRepository,
  type VerifiedAnalysisPlace,
} from "../src/application/saved-place-service.js";

const verifiedPlace: VerifiedAnalysisPlace = {
  id: "place-1",
  name: "Café Example",
  address: "Rua Example, 1",
  city: "São Paulo",
  country: "BR",
  provider: "google_places",
  providerPlaceId: "ChIJexample",
};

const savedPlace: SavedPlace = {
  ...verifiedPlace,
  userPlaceId: "user-place-1",
  status: "want_to_go",
  favorite: false,
};

class FakeSavedPlaceRepository implements SavedPlaceRepository {
  lookup: AnalysisPlaceLookup | undefined = { status: "verified", place: verifiedPlace };
  readonly findAnalysisPlace = vi.fn(async () => this.lookup);
  readonly upsertUserPlace = vi.fn(async () => savedPlace);
  readonly listUserPlaces = vi.fn(async () => [savedPlace]);
  readonly updateUserPlace = vi.fn(async (_userId: string, _userPlaceId: string, update: SavedPlaceUpdate): Promise<SavedPlace> => ({
    ...savedPlace,
    ...(update.status !== undefined ? { status: update.status } : {}),
    ...(update.favorite !== undefined ? { favorite: update.favorite } : {}),
    ...(update.notes !== undefined ? (update.notes ? { notes: update.notes } : {}) : {}),
  }));
  readonly deleteUserPlace = vi.fn(async () => true);
}

describe("SavedPlaceService", () => {
  it("saves only a verified place linked to the requested analysis for the resolved user", async () => {
    const repository = new FakeSavedPlaceRepository();
    const service = new SavedPlaceService({ repository });

    await expect(service.confirm("user-a", "analysis-1", "place-1")).resolves.toEqual(savedPlace);
    expect(repository.findAnalysisPlace).toHaveBeenCalledWith("user-a", "analysis-1", "place-1");
    expect(repository.upsertUserPlace).toHaveBeenCalledWith("user-a", verifiedPlace);
  });

  it("does not save a place outside the analysis", async () => {
    const repository = new FakeSavedPlaceRepository();
    repository.lookup = undefined;
    const service = new SavedPlaceService({ repository });

    await expect(service.confirm("user-a", "analysis-1", "other-place")).rejects.toBeInstanceOf(AnalysisPlaceNotFoundError);
    expect(repository.upsertUserPlace).not.toHaveBeenCalled();
  });

  it("does not save an unresolved analysis mention", async () => {
    const repository = new FakeSavedPlaceRepository();
    repository.lookup = { status: "unverified" };
    const service = new SavedPlaceService({ repository });

    await expect(service.confirm("user-a", "analysis-1", "mention-without-provider-place")).rejects.toBeInstanceOf(AnalysisPlaceUnverifiedError);
    expect(repository.upsertUserPlace).not.toHaveBeenCalled();
  });

  it("lists only the resolved user's library", async () => {
    const repository = new FakeSavedPlaceRepository();
    const service = new SavedPlaceService({ repository });

    await expect(service.list("user-a")).resolves.toEqual([savedPlace]);
    expect(repository.listUserPlaces).toHaveBeenCalledWith("user-a");
  });

  it("updates and removes only a saved place in the resolved user's library", async () => {
    const repository = new FakeSavedPlaceRepository();
    const service = new SavedPlaceService({ repository });

    await expect(service.update("user-a", "user-place-1", { status: "visited", favorite: true, notes: "  Great coffee  " }))
      .resolves.toMatchObject({ status: "visited", favorite: true, notes: "Great coffee" });
    await expect(service.remove("user-a", "user-place-1")).resolves.toBeUndefined();

    expect(repository.updateUserPlace).toHaveBeenCalledWith("user-a", "user-place-1", { status: "visited", favorite: true, notes: "Great coffee" });
    expect(repository.deleteUserPlace).toHaveBeenCalledWith("user-a", "user-place-1");
  });
});
