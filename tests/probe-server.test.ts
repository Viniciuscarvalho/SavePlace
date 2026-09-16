import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../src/domain/models.js";
import { createProbeServer, type SourceAnalyzer } from "../src/http/probe-server.js";

const servers: ReturnType<typeof createProbeServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
});

async function startServer(analyzer: SourceAnalyzer, options: { probeToken?: string } = { probeToken: "test-token" }): Promise<string> {
  const server = createProbeServer({ analyzer, probeToken: options.probeToken });
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

describe("Railway probe server", () => {
  it("serves an unauthenticated healthcheck", async () => {
    const baseUrl = await startServer({ execute: vi.fn() });
    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toEqual({ status: "ok", probeConfigured: true });
  });

  it("keeps health available but fails closed when its token is missing", async () => {
    const execute = vi.fn();
    const baseUrl = await startServer({ execute }, {});

    await expect(fetch(`${baseUrl}/health`).then((response) => response.json())).resolves.toEqual({ status: "ok", probeConfigured: false });

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
