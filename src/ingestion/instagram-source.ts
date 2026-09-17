import { z } from "zod";
import type { AcquisitionResult, Evidence } from "../domain/models.js";
import type { ContentSource } from "./content-source.js";
import type { FetchLike } from "./tiktok-source.js";

const InstagramOEmbedSchema = z.object({
  provider_name: z.literal("Instagram"),
  title: z.string().trim().max(4_000).optional(),
  author_name: z.string().trim().min(1).max(512).optional(),
  author_url: z.string().url().optional(),
  thumbnail_url: z.string().url().optional(),
  html: z.string().optional(),
});

const DEFAULT_TIMEOUT_MS = 10_000;
const INSTAGRAM_POST_PATH = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/i;

export type InstagramSourceOptions = {
  accessToken?: string | undefined;
  endpoint?: string | undefined;
  http?: FetchLike;
  timeoutMs?: number;
};

type InstagramPost = { canonicalUrl: string; contentId: string };

function isInstagramHost(hostname: string): boolean {
  return hostname === "instagram.com" || hostname.endsWith(".instagram.com");
}

function normalizeInstagramPostUrl(value: string): InstagramPost | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !isInstagramHost(url.hostname) || url.username || url.password || url.port) {
      return null;
    }

    const path = url.pathname.match(INSTAGRAM_POST_PATH);
    if (!path?.[1]) return null;

    url.hostname = "www.instagram.com";
    url.pathname = `/${url.pathname.split("/")[1]?.toLowerCase()}/${path[1]}/`;
    url.search = "";
    url.hash = "";
    return { canonicalUrl: url.toString(), contentId: path[1] };
  } catch {
    return null;
  }
}

/**
 * An oEmbed access token is sensitive. Restrict it to Meta's HTTPS Graph API
 * instead of allowing a configured endpoint to accidentally send it elsewhere.
 */
function officialOEmbedEndpoint(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const endpoint = new URL(value);
    const supportedPath = /^\/v\d+(?:\.\d+)?\/instagram_oembed\/?$|^\/instagram_oembed\/?$/;
    if (
      endpoint.protocol !== "https:" ||
      endpoint.hostname !== "graph.facebook.com" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      !supportedPath.test(endpoint.pathname)
    ) {
      return null;
    }
    return endpoint;
  } catch {
    return null;
  }
}

export class InstagramSource implements ContentSource {
  private readonly http: FetchLike;
  private readonly timeoutMs: number;

  constructor(private readonly options: InstagramSourceOptions = {}) {
    this.http = options.http ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  canHandle(input: string): boolean {
    return normalizeInstagramPostUrl(input) !== null;
  }

  async acquire(input: string): Promise<AcquisitionResult> {
    const post = normalizeInstagramPostUrl(input);
    if (!post) {
      return { status: "unsupported", reason: "Instagram acquisition requires a valid HTTPS post or Reel URL." };
    }

    const endpoint = officialOEmbedEndpoint(this.options.endpoint);
    const accessToken = this.options.accessToken?.trim();
    if (!endpoint || !accessToken) {
      return {
        status: "insufficient_evidence",
        platform: "instagram",
        canonicalUrl: post.canonicalUrl,
        reason: "Instagram oEmbed requires a configured official endpoint and access token.",
      };
    }

    try {
      endpoint.searchParams.set("url", post.canonicalUrl);
      endpoint.searchParams.set("access_token", accessToken);
      const response = await this.http(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return {
          status: "insufficient_evidence",
          platform: "instagram",
          canonicalUrl: post.canonicalUrl,
          reason: `Instagram oEmbed returned HTTP ${response.status}.`,
        };
      }

      const parsed = InstagramOEmbedSchema.safeParse(await response.json());
      if (!parsed.success) {
        return {
          status: "insufficient_evidence",
          platform: "instagram",
          canonicalUrl: post.canonicalUrl,
          reason: "Instagram oEmbed returned an unsupported response.",
        };
      }

      const data = parsed.data;
      const evidence: Evidence[] = [];
      if (data.title) evidence.push({ type: "description", text: data.title, sourceUrl: post.canonicalUrl });
      if (data.author_name) evidence.push({ type: "author", text: data.author_name, sourceUrl: post.canonicalUrl });
      if (data.thumbnail_url) evidence.push({ type: "thumbnail", text: "Instagram cover image", sourceUrl: data.thumbnail_url });

      if (!data.title && !data.thumbnail_url) {
        return {
          status: "insufficient_evidence",
          platform: "instagram",
          canonicalUrl: post.canonicalUrl,
          reason: "Instagram exposed no textual or visual evidence useful for place extraction.",
        };
      }

      return {
        status: "acquired",
        source: {
          input,
          canonicalUrl: post.canonicalUrl,
          contentId: post.contentId,
          platform: "instagram",
          ...(data.author_name ? { author: data.author_name } : {}),
          ...(data.title ? { description: data.title } : {}),
          ...(data.thumbnail_url ? { thumbnailUrl: data.thumbnail_url } : {}),
          evidence,
        },
      };
    } catch {
      return {
        status: "insufficient_evidence",
        platform: "instagram",
        canonicalUrl: post.canonicalUrl,
        reason: "Instagram evidence acquisition failed.",
      };
    }
  }
}
