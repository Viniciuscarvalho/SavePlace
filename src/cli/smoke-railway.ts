import { z } from "zod";

const ProbeResponseSchema = z.object({
  status: z.enum(["completed", "insufficient_evidence", "needs_review", "failed"]),
  source: z.object({
    platform: z.literal("tiktok"),
    canonicalUrl: z.string().url(),
    contentId: z.string().regex(/^\d+$/),
  }),
  evidenceTypes: z.array(z.enum(["title", "description", "author", "thumbnail", "embed", "transcript", "page_metadata"])),
  candidateCount: z.number().int().nonnegative(),
  placeCount: z.number().int().nonnegative(),
  extractionMethod: z.literal("url_metadata"),
});

const baseUrl = process.env.SAVEPLACE_PROBE_URL;
const probeToken = process.env.PROBE_TOKEN;
if (!baseUrl || !probeToken) {
  throw new Error("SAVEPLACE_PROBE_URL and PROBE_TOKEN must be set.");
}

const endpoint = new URL("/internal/probes/tiktok", baseUrl);
const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${probeToken}` } });
if (!response.ok) {
  if (response.status === 503) {
    throw new Error("Railway probe is unavailable. Configure a non-empty PROBE_TOKEN as a service variable for this deployment environment, then redeploy.");
  }
  throw new Error(`Railway probe returned HTTP ${response.status}.`);
}

const result = ProbeResponseSchema.parse(await response.json());
if (result.status !== "needs_review" || !result.evidenceTypes.includes("description")) {
  throw new Error("Railway probe did not acquire the expected TikTok URL evidence.");
}

console.log(JSON.stringify(result, null, 2));
