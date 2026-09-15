import { describe, expect, it } from "vitest";
import { YouTubeSource } from "../src/ingestion/youtube-source.js";

describe("YouTubeSource", () => {
  it("recognizes a YouTube Short without requesting an upload", async () => {
    const source = new YouTubeSource();
    const input = "https://www.youtube.com/shorts/19Ls-ZMU86c";

    expect(source.canHandle(input)).toBe(true);
    await expect(source.acquire(input)).resolves.toMatchObject({
      status: "insufficient_evidence",
      platform: "youtube",
    });
  });
});
