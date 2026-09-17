import { describe, expect, it } from "vitest";
import { InstagramSource } from "../src/ingestion/instagram-source.js";

const accessToken = process.env.INSTAGRAM_OEMBED_ACCESS_TOKEN?.trim();
const endpoint = process.env.INSTAGRAM_OEMBED_ENDPOINT?.trim();
const input = process.env.INSTAGRAM_OEMBED_TEST_URL?.trim();
const enabled = process.env.RUN_INSTAGRAM_OEMBED_INTEGRATION === "1" && Boolean(accessToken && endpoint && input);
const describeLive = enabled ? describe : describe.skip;

describeLive("InstagramSource live integration", () => {
  it("acquires evidence through the configured official oEmbed application", async () => {
    const result = await new InstagramSource({ accessToken, endpoint }).acquire(input!);

    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") return;
    expect(result.source.platform).toBe("instagram");
    expect(result.source.canonicalUrl).toMatch(/^https:\/\/www\.instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+\/$/);
    expect(result.source.evidence.length).toBeGreaterThan(0);
  }, 20_000);
});
