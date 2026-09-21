import { describe, expect, it, vi } from "vitest";
import { runM1DeploymentCheck } from "../src/application/m1-deployment-check.js";

const analysisId = "00000000-0000-4000-8000-000000000001";
const placeId = "00000000-0000-4000-8000-000000000002";
const userPlaceId = "00000000-0000-4000-8000-000000000003";

function analysis(cache: "hit" | "miss", replayed: boolean, verifiedPlaceReferences = [{ placeId, provider: "google_places", providerPlaceId: "ChIJexample" }]) {
  return {
    cache,
    replayed,
    analysisId,
    verifiedPlaceReferences,
    result: { source: { platform: "tiktok" } },
  };
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("M1 deployment check", () => {
  it("proves health, idempotency replay, cache reuse, confirmation and the saved library", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok", analysisApiConfigured: true }))
      .mockResolvedValueOnce(response(analysis("miss", false), 200, { "set-cookie": "saveplace_session=session-a; Path=/; HttpOnly" }))
      .mockResolvedValueOnce(response(analysis("miss", true)))
      .mockResolvedValueOnce(response(analysis("hit", false)))
      .mockResolvedValueOnce(response({ place: { id: placeId, userPlaceId } }))
      .mockResolvedValueOnce(response({ places: [{ id: placeId, userPlaceId }] }));

    await expect(runM1DeploymentCheck({
      baseUrl: "https://saveplace.example",
      apiToken: "test-token",
      idempotencyKeyFactory: () => "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toEqual({
      status: "ok",
      analysisId,
      firstCache: "miss",
      cachedCache: "hit",
      verifiedPlaceCount: 1,
      savedPlaceId: placeId,
      userPlaceId,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const replayHeaders = new Headers(fetchImpl.mock.calls[2]?.[1]?.headers);
    const cachedHeaders = new Headers(fetchImpl.mock.calls[3]?.[1]?.headers);
    expect(replayHeaders.get("idempotency-key")).toBe("m1-smoke-test");
    expect(cachedHeaders.get("idempotency-key")).toBe("m1-smoke-cache-test");
    expect(replayHeaders.get("cookie")).toBe("saveplace_session=session-a");
  });

  it("fails before confirmation when the deployed pipeline has no verified place", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ status: "ok", analysisApiConfigured: true }))
      .mockResolvedValueOnce(response(analysis("hit", false, [])))
      .mockResolvedValueOnce(response(analysis("hit", true, [])))
      .mockResolvedValueOnce(response(analysis("hit", false, [])));

    await expect(runM1DeploymentCheck({
      baseUrl: "https://saveplace.example",
      apiToken: "test-token",
      idempotencyKeyFactory: () => "test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow("no provider-verified place");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
