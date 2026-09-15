import { z } from "zod";
import type { AcquisitionResult, Evidence } from "../domain/models.js";
import type { ContentSource } from "./content-source.js";

const TikTokOEmbedSchema = z.object({
  title: z.string().default(""),
  author_name: z.string().optional(),
  author_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  html: z.string().optional(),
});

export type FetchLike = typeof fetch;

export class TikTokSource implements ContentSource {
  constructor(private readonly http: FetchLike = fetch) {}

  canHandle(input: string): boolean {
    try {
      const host = new URL(input).hostname;
      return host === "tiktok.com" || host.endsWith(".tiktok.com");
    } catch { return false; }
  }

  async acquire(input: string): Promise<AcquisitionResult> {
    try {
      const canonicalUrl = await this.resolveCanonicalUrl(input);
      const endpoint = new URL("https://www.tiktok.com/oembed");
      endpoint.searchParams.set("url", canonicalUrl);

      const response = await this.http(endpoint, { headers: { Accept: "application/json" }, redirect: "follow" });
      if (!response.ok) {
        return { status: "insufficient_evidence", platform: "tiktok", canonicalUrl, reason: `TikTok oEmbed returned HTTP ${response.status}.` };
      }

      const parsed = TikTokOEmbedSchema.safeParse(await response.json());
      if (!parsed.success) {
        return { status: "insufficient_evidence", platform: "tiktok", canonicalUrl, reason: "TikTok oEmbed returned an unsupported response." };
      }

      const data = parsed.data;
      const evidence: Evidence[] = [];
      if (data.title.trim()) evidence.push({ type: "description", text: data.title.trim() });
      if (data.author_name) evidence.push({ type: "author", text: data.author_name });
      if (data.thumbnail_url) evidence.push({ type: "thumbnail", text: "TikTok cover image", sourceUrl: data.thumbnail_url });

      if (!data.title.trim() && !data.thumbnail_url) {
        return { status: "insufficient_evidence", platform: "tiktok", canonicalUrl, reason: "TikTok exposed no textual or visual evidence useful for place extraction." };
      }

      return {
        status: "acquired",
        source: {
          input,
          canonicalUrl,
          platform: "tiktok",
          ...(data.author_name ? { author: data.author_name } : {}),
          ...(data.title.trim() ? { description: data.title.trim() } : {}),
          ...(data.thumbnail_url ? { thumbnailUrl: data.thumbnail_url } : {}),
          evidence,
        },
      };
    } catch (error) {
      return { status: "insufficient_evidence", platform: "tiktok", reason: error instanceof Error ? error.message : "TikTok evidence acquisition failed." };
    }
  }

  private async resolveCanonicalUrl(input: string): Promise<string> {
    const url = new URL(input);
    if (url.hostname !== "vt.tiktok.com" && url.hostname !== "vm.tiktok.com") return url.toString();
    const response = await this.http(url, { method: "HEAD", redirect: "follow" });
    return response.url || url.toString();
  }
}
