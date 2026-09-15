import { describe, expect, it } from "vitest";
import { TikTokSource } from "../src/ingestion/tiktok-source.js";

const describeLive = process.env.RUN_TIKTOK_INTEGRATION === "1" ? describe : describe.skip;

describeLive("TikTokSource live integration", () => {
  it("acquires real place evidence from the M0 acceptance short URL", async () => {
    const input = "https://vt.tiktok.com/ZSq4UprxR/";
    const result = await new TikTokSource().acquire(input);

    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") return;

    expect(result.source.canonicalUrl).toMatch(/^https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+$/);
    expect(result.source.contentId).toMatch(/^\d+$/);
    expect(result.source.description).toMatch(/Madre/i);
    expect(result.source.description).toMatch(/Pinheiros/i);
    expect(result.source.evidence.some((item) => item.type === "description")).toBe(true);
  }, 20_000);
});
