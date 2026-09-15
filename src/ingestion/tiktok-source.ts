import { z } from "zod";
import type { AcquisitionResult, Evidence } from "../domain/models.js";
import type { ContentSource } from "./content-source.js";

const TikTokOEmbedSchema = z.object({
  type: z.literal("video"),
  title: z.string().default(""),
  author_name: z.string().optional(),
  author_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  html: z.string().min(1),
  provider_name: z.literal("TikTok"),
});

export type FetchLike = typeof fetch;

const TIKTOK_OEMBED_ENDPOINT = "https://www.tiktok.com/oembed";
const DEFAULT_TIMEOUT_MS = 10_000;

function isTikTokHost(hostname: string): boolean {
  return hostname === "tiktok.com" || hostname.endsWith(".tiktok.com");
}

function normalizeTikTokUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !isTikTokHost(url.hostname) || url.username || url.password || url.port) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * TikTok's official oEmbed markup includes the canonical post URL in the
 * blockquote `cite` attribute. Reading it from the validated provider response
 * avoids following a short-link redirect in application code.
 */
function canonicalUrlFromOEmbed(html: string): { canonicalUrl: string; contentId: string } | null {
  const match = html.match(/<blockquote\b[^>]*\bcite=["']([^"']+)["'][^>]*>/i);
  if (!match?.[1]) return null;

  const url = normalizeTikTokUrl(match[1]);
  const pathMatch = url?.pathname.match(/^\/@[^/]+\/video\/(\d+)\/?$/);
  if (!url || !pathMatch?.[1]) return null;

  url.search = "";
  url.hash = "";
  return { canonicalUrl: url.toString(), contentId: pathMatch[1] };
}

export class TikTokSource implements ContentSource {
  constructor(
    private readonly http: FetchLike = fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  canHandle(input: string): boolean {
    return normalizeTikTokUrl(input) !== null;
  }

  async acquire(input: string): Promise<AcquisitionResult> {
    try {
      const inputUrl = normalizeTikTokUrl(input);
      if (!inputUrl) {
        return { status: "unsupported", reason: "TikTok acquisition requires a valid HTTPS TikTok URL." };
      }

      // The official endpoint accepts vt.tiktok.com/vm.tiktok.com URLs and
      // resolves them server-side. Do not preflight the short URL with a
      // generic HEAD/GET request: that behavior varies by runtime and CDN.
      const endpoint = new URL(TIKTOK_OEMBED_ENDPOINT);
      endpoint.searchParams.set("url", inputUrl.toString());

      const response = await this.http(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return { status: "insufficient_evidence", platform: "tiktok", reason: `TikTok oEmbed returned HTTP ${response.status}.` };
      }

      const parsed = TikTokOEmbedSchema.safeParse(await response.json());
      if (!parsed.success) {
        return { status: "insufficient_evidence", platform: "tiktok", reason: "TikTok oEmbed returned an unsupported response." };
      }

      const data = parsed.data;
      const canonical = canonicalUrlFromOEmbed(data.html);
      if (!canonical) {
        return {
          status: "insufficient_evidence",
          platform: "tiktok",
          reason: "TikTok oEmbed did not expose a valid canonical video URL.",
        };
      }

      const evidence: Evidence[] = [];
      if (data.title.trim()) evidence.push({ type: "description", text: data.title.trim(), sourceUrl: canonical.canonicalUrl });
      if (data.author_name) evidence.push({ type: "author", text: data.author_name, sourceUrl: canonical.canonicalUrl });
      if (data.thumbnail_url) evidence.push({ type: "thumbnail", text: "TikTok cover image", sourceUrl: data.thumbnail_url });

      if (!data.title.trim() && !data.thumbnail_url) {
        return { status: "insufficient_evidence", platform: "tiktok", canonicalUrl: canonical.canonicalUrl, reason: "TikTok exposed no textual or visual evidence useful for place extraction." };
      }

      return {
        status: "acquired",
        source: {
          input,
          canonicalUrl: canonical.canonicalUrl,
          contentId: canonical.contentId,
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
}
