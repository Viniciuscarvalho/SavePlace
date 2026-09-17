import { describe, expect, it, vi } from "vitest";
import {
  AnalysisPlaceNotFoundError,
  AnalysisPlaceUnverifiedError,
  SavedPlaceService,
  type AnalysisPlaceLookup,
  type SavedPlace,
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
  readonly upsertUserPlace = vi.fn(async () => savedPlace);
  readonly listUserPlaces = vi.fn(async () => [savedPlace]);

  async findAnalysisPlace(): Promise<AnalysisPlaceLookup | undefined> {
    return this.lookup;
  }
}

describe("SavedPlaceService", () => {
  it("saves only a verified place linked to the requested analysis for the server-owned user", async () => {
    const repository = new FakeSavedPlaceRepository();
    const service = new SavedPlaceService({ repository, ownerUserId: "local-owner" });

    await expect(service.confirm("analysis-1", "place-1")).resolves.toEqual(savedPlace);
    expect(repository.upsertUserPlace).toHaveBeenCalledWith("local-owner", verifiedPlace);
  });

  it("does not save a place outside the analysis", async () => {
    const repository = new FakeSavedPlaceRepository();
    repository.lookup = undefined;
    const service = new SavedPlaceService({ repository, ownerUserId: "local-owner" });

    await expect(service.confirm("analysis-1", "other-place")).rejects.toBeInstanceOf(AnalysisPlaceNotFoundError);
    expect(repository.upsertUserPlace).not.toHaveBeenCalled();
  });

  it("does not save an unresolved analysis mention", async () => {
    const repository = new FakeSavedPlaceRepository();
    repository.lookup = { status: "unverified" };
    const service = new SavedPlaceService({ repository, ownerUserId: "local-owner" });

    await expect(service.confirm("analysis-1", "mention-without-provider-place")).rejects.toBeInstanceOf(AnalysisPlaceUnverifiedError);
    expect(repository.upsertUserPlace).not.toHaveBeenCalled();
  });

  it("lists only the server-owned user's library", async () => {
    const repository = new FakeSavedPlaceRepository();
    const service = new SavedPlaceService({ repository, ownerUserId: "local-owner" });

    await expect(service.list()).resolves.toEqual([savedPlace]);
    expect(repository.listUserPlaces).toHaveBeenCalledWith("local-owner");
  });
});
