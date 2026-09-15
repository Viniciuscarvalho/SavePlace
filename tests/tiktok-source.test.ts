import { describe, expect, it, vi } from "vitest";
import { TikTokSource } from "../src/ingestion/tiktok-source.js";

describe("TikTokSource", () => {
  it("turns official oEmbed metadata into evidence", async () => {
    const http = vi.fn()
      .mockResolvedValueOnce({ url: "https://www.tiktok.com/@creator/video/123" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          title: "Um restaurante incrível em São Paulo #food",
          author_name: "Creator",
          thumbnail_url: "https://example.com/cover.jpg",
        }),
      });

    const result = await new TikTokSource(http as unknown as typeof fetch).acquire("https://vt.tiktok.com/ZSq4DkXGA/");
    expect(result.status).toBe("acquired");
    if (result.status === "acquired") {
      expect(result.source.canonicalUrl).toContain("/video/123");
      expect(result.source.evidence.map((item) => item.type)).toEqual(["description", "author", "thumbnail"]);
    }
  });

  it("does not request an upload when evidence is unavailable", async () => {
    const http = vi.fn().mockResolvedValue({ ok: false, status: 404, url: "https://www.tiktok.com/@creator/video/123" });
    const result = await new TikTokSource(http as unknown as typeof fetch).acquire("https://www.tiktok.com/@creator/video/123");
    expect(result).toMatchObject({ status: "insufficient_evidence", platform: "tiktok" });
  });
});
