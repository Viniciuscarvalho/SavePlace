import type { AcquisitionResult } from "../domain/models.js";
import type { ContentSource } from "./content-source.js";

/**
 * M0 policy: a YouTube URL is a source reference, not permission or a guarantee
 * that the underlying media can be downloaded. We intentionally do not hide a
 * scraper/downloader behind this adapter. Metadata/transcript acquisition can
 * be added through an approved/reliable provider later.
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
      status: "media_required",
      platform: "youtube",
      reason: "The YouTube URL was recognized, but M0 does not assume direct access to protected social video media or transcripts.",
      nextAction: "upload_video",
    };
  }
}
