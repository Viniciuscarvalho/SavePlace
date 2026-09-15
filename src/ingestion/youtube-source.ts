import type { AcquisitionResult } from "../domain/models.js";
import type { ContentSource } from "./content-source.js";

/**
 * YouTube is deferred while M0 validates URL-only TikTok acquisition. A social
 * URL is never treated as permission to download the underlying media.
 */
export class YouTubeSource implements ContentSource {
  canHandle(input: string): boolean {
    try {
      const url = new URL(input);
      return ["youtube.com", "www.youtube.com", "youtu.be", "m.youtube.com"].includes(url.hostname);
    } catch {
      return false;
    }
  }

  async acquire(_input: string): Promise<AcquisitionResult> {
    return {
      status: "insufficient_evidence",
      platform: "youtube",
      reason: "YouTube URL evidence acquisition is deferred while M0 validates TikTok.",
    };
  }
}
