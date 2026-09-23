import { describe, expect, it, vi } from "vitest";
import { BrowserSessionService, type BrowserSessionRecord, type BrowserSessionRepository } from "../src/application/browser-session-service.js";
import { createBrowserAnalysisRequestHandler } from "../src/http/browser-analysis.js";

class MemorySessionRepository implements BrowserSessionRepository {
  async findSessionUserId(): Promise<string | undefined> { return undefined; }
  async createSession(_session: BrowserSessionRecord): Promise<void> {}
}

describe("browser analysis route", () => {
  it("keeps API_TOKEN server-side while reusing the product analysis contract", async () => {
    const analyze = vi.fn().mockResolvedValue({ replayed: false, status: 200, body: { cache: "miss", analysisId: "analysis-1", result: { status: "needs_review" } } });
    const browserSessions = new BrowserSessionService(new MemorySessionRepository(), {
      tokenFactory: () => "0".repeat(43), userIdFactory: () => "browser-user",
    });
    const handle = createBrowserAnalysisRequestHandler({
      analyzer: { execute: vi.fn() }, apiToken: "server-only-token", analysisApi: { analyze, get: vi.fn() }, browserSessions,
    });

    const response = await handle(new Request("http://localhost/api/analyses", {
      method: "POST", headers: { "authorization": "Bearer browser-value", "content-type": "application/json", "idempotency-key": "request-1" }, body: JSON.stringify({ url: "https://vt.tiktok.com/example/" }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(analyze).toHaveBeenCalledWith("browser-user", "https://vt.tiktok.com/example/", "request-1");
  });
});
