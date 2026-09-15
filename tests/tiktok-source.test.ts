import { describe, expect, it, vi } from "vitest";
import { TikTokSource } from "../src/ingestion/tiktok-source.js";

describe("TikTokSource", () => {
  it("lets official oEmbed resolve a short URL and turns metadata into evidence", async () => {
    const http = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "video",
        title: "Um restaurante incrível em São Paulo #food",
        author_name: "Creator",
        thumbnail_url: "https://example.com/cover.jpg",
        provider_name: "TikTok",
        html: '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@creator/video/123?refer=embed" data-video-id="123"></blockquote>',
      }),
    });

    const result = await new TikTokSource(http as unknown as typeof fetch).acquire("https://vt.tiktok.com/ZSq4DkXGA/");
    expect(http).toHaveBeenCalledTimes(1);
    expect(String(http.mock.calls[0]?.[0])).toContain("/oembed?url=https%3A%2F%2Fvt.tiktok.com%2FZSq4DkXGA%2F");
    expect(result.status).toBe("acquired");
    if (result.status === "acquired") {
      expect(result.source.canonicalUrl).toBe("https://www.tiktok.com/@creator/video/123");
      expect(result.source.contentId).toBe("123");
      expect(result.source.evidence.map((item) => item.type)).toEqual(["description", "author", "thumbnail"]);
    }
  });

  it("does not request an upload when evidence is unavailable", async () => {
    const http = vi.fn().mockResolvedValue({ ok: false, status: 404, url: "https://www.tiktok.com/@creator/video/123" });
    const result = await new TikTokSource(http as unknown as typeof fetch).acquire("https://www.tiktok.com/@creator/video/123");
    expect(result).toMatchObject({ status: "insufficient_evidence", platform: "tiktok" });
  });

  it("rejects non-HTTPS and lookalike TikTok URLs before acquisition", async () => {
    const http = vi.fn();
    const source = new TikTokSource(http as unknown as typeof fetch);

    expect(source.canHandle("http://vt.tiktok.com/ZSq4UprxR/")).toBe(false);
    expect(source.canHandle("https://tiktok.com.example.com/ZSq4UprxR/")).toBe(false);
    await expect(source.acquire("https://tiktok.com.example.com/ZSq4UprxR/")).resolves.toMatchObject({ status: "unsupported" });
    expect(http).not.toHaveBeenCalled();
  });

  it("fails closed when oEmbed does not identify a canonical TikTok video", async () => {
    const http = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        type: "video",
        title: "Ambiguous response",
        provider_name: "TikTok",
        html: '<blockquote cite="https://example.com/video/123"></blockquote>',
      }),
    });

    await expect(new TikTokSource(http as unknown as typeof fetch).acquire("https://vt.tiktok.com/ZSq4UprxR/"))
      .resolves.toMatchObject({ status: "insufficient_evidence", platform: "tiktok" });
  });

  it.each([
    ["network failure", vi.fn().mockRejectedValue(new Error("network unavailable"))],
    ["invalid JSON", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } })],
  ])("returns insufficient evidence on %s", async (_scenario, http) => {
    await expect(new TikTokSource(http as unknown as typeof fetch).acquire("https://vt.tiktok.com/ZSq4UprxR/"))
      .resolves.toMatchObject({ status: "insufficient_evidence", platform: "tiktok" });
  });
});
