import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../src/domain/models.js";
import { AnalysisPlaceNotFoundError, type SavedPlace } from "../src/application/saved-place-service.js";
import { BrowserSessionService, type BrowserSessionRecord, type BrowserSessionRepository } from "../src/application/browser-session-service.js";
import { createProbeServer, createProductRequestHandler, type AnalysisApi, type SavedPlacesApi, type SourceAnalyzer } from "../src/http/probe-server.js";

const servers: ReturnType<typeof createProbeServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

class MemorySessionRepository implements BrowserSessionRepository {
  readonly sessions = new Map<string, BrowserSessionRecord>();

  async findSessionUserId(tokenHash: string, now: Date): Promise<string | undefined> {
    const session = this.sessions.get(tokenHash);
    return session && session.expiresAt > now ? session.userId : undefined;
  }

  async createSession(session: BrowserSessionRecord): Promise<void> {
    this.sessions.set(session.tokenHash, session);
  }
}

function browserSessions(): BrowserSessionService {
  const repository = new MemorySessionRepository();
  let sequence = 0;
  return new BrowserSessionService(repository, {
    tokenFactory: () => `${++sequence}`.padStart(43, "0"),
    userIdFactory: () => `browser-user-${sequence}`,
  });
}

async function startServer(analyzer: SourceAnalyzer, options: { probeToken?: string; apiToken?: string; analysisApi?: AnalysisApi; savedPlacesApi?: SavedPlacesApi; browserSessions?: BrowserSessionService } = { probeToken: "test-token" }): Promise<string> {
  const server = createProbeServer({
    analyzer,
    probeToken: options.probeToken,
    apiToken: options.apiToken,
    analysisApi: options.analysisApi,
    savedPlacesApi: options.savedPlacesApi,
    browserSessions: options.browserSessions,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

const acquiredResult: AnalysisResult = {
  status: "needs_review",
  source: { input: "https://vt.tiktok.com/ZSq4UprxR/", platform: "tiktok", canonicalUrl: "https://www.tiktok.com/@creator/video/123", contentId: "123" },
  evidence: [
    { type: "description", text: "Private caption text", sourceUrl: "https://www.tiktok.com/@creator/video/123" },
    { type: "author", text: "Creator", sourceUrl: "https://www.tiktok.com/@creator/video/123" },
  ],
  candidates: [],
  places: [],
  processing: { extractionMethod: "url_metadata", durationMs: 10 },
  nextAction: "review",
};

const savedPlace: SavedPlace = {
  userPlaceId: "user-place-1",
  id: "place-1",
  name: "Café Example",
  address: "Rua Example, 1",
  city: "São Paulo",
  country: "BR",
  provider: "google_places",
  providerPlaceId: "ChIJexample",
  status: "want_to_go",
  favorite: false,
};

describe("Railway probe server", () => {
  it("serves the health contract as a Web Request handler for Next routes", async () => {
    const handle = createProductRequestHandler({ analyzer: { execute: vi.fn() }, probeToken: "test-token" });

    const response = await handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok", probeConfigured: true, analysisApiConfigured: false });
  });

  it("serves an unauthenticated healthcheck", async () => {
    const baseUrl = await startServer({ execute: vi.fn() });
    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toEqual({ status: "ok", probeConfigured: true, analysisApiConfigured: false });
  });

  it("keeps health available but fails closed when its token is missing", async () => {
    const execute = vi.fn();
    const baseUrl = await startServer({ execute }, {});

    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toEqual({ status: "ok", probeConfigured: false, analysisApiConfigured: false });

    const response = await fetch(`${baseUrl}/internal/probes/tiktok`, {
      method: "POST",
      headers: { Authorization: "Bearer any-token" },
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "probe_unavailable" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a token and rejects other methods", async () => {
    const baseUrl = await startServer({ execute: vi.fn() });

    await expect(fetch(`${baseUrl}/internal/probes/tiktok`, { method: "POST" }).then((response) => response.status)).resolves.toBe(401);
    const response = await fetch(`${baseUrl}/internal/probes/tiktok`);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("resolves a private browser session, requires idempotency, and returns the service result", async () => {
    const analyze = vi.fn().mockResolvedValue({
      replayed: false,
      status: 200,
      body: { cache: "miss", analysisId: "analysis-1", result: acquiredResult },
    });
    const baseUrl = await startServer({ execute: vi.fn() }, { probeToken: "test-token", apiToken: "api-token", analysisApi: { analyze, get: vi.fn() }, browserSessions: browserSessions() });

    await expect(fetch(`${baseUrl}/v1/analyses`, { method: "POST" }).then((response) => response.status))
      .resolves.toBe(401);
    await expect(fetch(`${baseUrl}/v1/analyses`, { method: "POST", headers: { Authorization: "Bearer api-token" } }).then((response) => response.json()))
      .resolves.toEqual({ error: "idempotency_key_required" });
    const response = await fetch(`${baseUrl}/v1/analyses`, {
      method: "POST",
      headers: { Authorization: "Bearer api-token", "Idempotency-Key": "key-1", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://vt.tiktok.com/example/" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    await expect(response.json()).resolves.toMatchObject({ cache: "miss", analysisId: "analysis-1", replayed: false });
    expect(analyze).toHaveBeenCalledWith("browser-user-0", "https://vt.tiktok.com/example/", "key-1");
  });

  it("requires explicit confirmation for a verified analysis place and lists the saved library", async () => {
    const confirm = vi.fn().mockResolvedValue(savedPlace);
    const list = vi.fn().mockResolvedValue([savedPlace]);
    const baseUrl = await startServer(
      { execute: vi.fn() },
      { probeToken: "test-token", apiToken: "api-token", savedPlacesApi: { confirm, list }, browserSessions: browserSessions() },
    );

    const libraryResponse = await fetch(`${baseUrl}/v1/places`, { headers: { Authorization: "Bearer api-token" } });
    const cookie = libraryResponse.headers.get("set-cookie");
    await expect(libraryResponse.json()).resolves.toEqual({ places: [savedPlace] });
    expect(list).toHaveBeenCalledWith("browser-user-0");

    const response = await fetch(`${baseUrl}/v1/analyses/analysis-1/places/place-1/save`, {
      method: "POST",
      headers: { Authorization: "Bearer api-token", Cookie: cookie! },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ place: savedPlace });
    expect(confirm).toHaveBeenCalledWith("browser-user-0", "analysis-1", "place-1");
  });

  it("does not share an idempotency scope or library between browser sessions", async () => {
    const analyze = vi.fn().mockResolvedValue({ replayed: false, status: 200, body: { cache: "hit", analysisId: "analysis-1", result: acquiredResult } });
    const list = vi.fn().mockResolvedValue([]);
    const baseUrl = await startServer(
      { execute: vi.fn() },
      { probeToken: "test-token", apiToken: "api-token", analysisApi: { analyze, get: vi.fn() }, savedPlacesApi: { confirm: vi.fn(), list }, browserSessions: browserSessions() },
    );

    const first = await fetch(`${baseUrl}/v1/analyses`, {
      method: "POST",
      headers: { Authorization: "Bearer api-token", "Idempotency-Key": "same-key", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://vt.tiktok.com/example/" }),
    });
    const firstCookie = first.headers.get("set-cookie");
    const second = await fetch(`${baseUrl}/v1/analyses`, {
      method: "POST",
      headers: { Authorization: "Bearer api-token", "Idempotency-Key": "same-key", "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://vt.tiktok.com/example/" }),
    });
    const secondCookie = second.headers.get("set-cookie");
    await fetch(`${baseUrl}/v1/places`, { headers: { Authorization: "Bearer api-token", Cookie: firstCookie! } });
    await fetch(`${baseUrl}/v1/places`, { headers: { Authorization: "Bearer api-token", Cookie: secondCookie! } });

    expect(analyze).toHaveBeenNthCalledWith(1, "browser-user-0", "https://vt.tiktok.com/example/", "same-key");
    expect(analyze).toHaveBeenNthCalledWith(2, "browser-user-1", "https://vt.tiktok.com/example/", "same-key");
    expect(list).toHaveBeenNthCalledWith(1, "browser-user-0");
    expect(list).toHaveBeenNthCalledWith(2, "browser-user-1");
  });

  it("returns an analysis only to the browser session linked to it", async () => {
    const analysisId = "00000000-0000-4000-8000-000000000001";
    const get = vi.fn().mockImplementation(async (userId: string) => userId === "browser-user-0"
      ? { status: 200 as const, body: { analysisId, result: acquiredResult } }
      : undefined);
    const baseUrl = await startServer(
      { execute: vi.fn() },
      { probeToken: "test-token", apiToken: "api-token", analysisApi: { analyze: vi.fn(), get }, browserSessions: browserSessions() },
    );

    const first = await fetch(`${baseUrl}/v1/analyses/${analysisId}`, { headers: { Authorization: "Bearer api-token" } });
    const firstCookie = first.headers.get("set-cookie");
    await expect(first.json()).resolves.toMatchObject({ analysisId });

    const second = await fetch(`${baseUrl}/v1/analyses/${analysisId}`, { headers: { Authorization: "Bearer api-token" } });
    expect(second.status).toBe(404);
    await expect(second.json()).resolves.toEqual({ error: "analysis_not_found" });
    expect(get).toHaveBeenNthCalledWith(1, "browser-user-0", analysisId);
    expect(get).toHaveBeenNthCalledWith(2, "browser-user-1", analysisId);

    const replay = await fetch(`${baseUrl}/v1/analyses/${analysisId}`, { headers: { Authorization: "Bearer api-token", Cookie: firstCookie! } });
    expect(replay.status).toBe(200);
    expect(get).toHaveBeenNthCalledWith(3, "browser-user-0", analysisId);
  });

  it("does not save a place that the repository cannot prove belongs to the analysis", async () => {
    const baseUrl = await startServer(
      { execute: vi.fn() },
      {
        probeToken: "test-token",
        apiToken: "api-token",
        savedPlacesApi: { confirm: vi.fn().mockRejectedValue(new AnalysisPlaceNotFoundError()), list: vi.fn() },
        browserSessions: browserSessions(),
      },
    );

    const response = await fetch(`${baseUrl}/v1/analyses/analysis-1/places/place-2/save`, {
      method: "POST",
      headers: { Authorization: "Bearer api-token" },
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "analysis_place_not_found" });
  });

  it("returns an allowlisted acquisition result", async () => {
    const execute = vi.fn().mockResolvedValue(acquiredResult);
    const baseUrl = await startServer({ execute });

    const response = await fetch(`${baseUrl}/internal/probes/tiktok`, { method: "POST", headers: { Authorization: "Bearer test-token" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith("https://vt.tiktok.com/ZSq4UprxR/");
    expect(body).toEqual({
      status: "needs_review",
      source: acquiredResult.source,
      evidenceTypes: ["description", "author"],
      candidateCount: 0,
      placeCount: 0,
      extractionMethod: "url_metadata",
    });
    expect(JSON.stringify(body)).not.toContain("Private caption text");
  });

  it("reports an acquired-but-insufficient result without exposing its reason", async () => {
    const baseUrl = await startServer({
      execute: vi.fn().mockResolvedValue({
        ...acquiredResult,
        status: "insufficient_evidence",
        evidence: [],
        processing: { extractionMethod: "none", durationMs: 10 },
        reason: "Third-party response details must not be exposed.",
      }),
    });

    const response = await fetch(`${baseUrl}/internal/probes/tiktok`, { method: "POST", headers: { Authorization: "Bearer test-token" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "insufficient_evidence", evidenceTypes: [] });
    expect(JSON.stringify(body)).not.toContain("Third-party response details");
  });

  it("returns a safe error when acquisition throws", async () => {
    const baseUrl = await startServer({ execute: vi.fn().mockRejectedValue(new Error("sensitive upstream error")) });
    const response = await fetch(`${baseUrl}/internal/probes/tiktok`, { method: "POST", headers: { Authorization: "Bearer test-token" } });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "probe_failed" });
  });
});
