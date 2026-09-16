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

const baseUrl = process.env.SAVEPLACE_PROBE_URL?.trim();
const probeToken = process.env.PROBE_TOKEN?.trim();
if (!baseUrl || !probeToken) {
  throw new Error("SAVEPLACE_PROBE_URL and PROBE_TOKEN must be set.");
}

const endpoint = new URL("/internal/probes/tiktok", baseUrl);
const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${probeToken}` } });
if (!response.ok) {
  const body = await response.json().catch(() => ({}));
  if (response.status === 503) {
    throw new Error("Railway probe is unavailable: the deployed process has no non-empty PROBE_TOKEN. In Railway, open the SavePlace service in the active environment, set PROBE_TOKEN to the exact non-empty secret, save, then redeploy.");
  }
  if (response.status === 401) {
    throw new Error("Railway probe rejected the token (HTTP 401). Confirm the local PROBE_TOKEN exactly matches the active Railway service variable, without extra whitespace, then rerun after deployment.");
  }
  if (response.status === 502) {
    throw new Error("Railway probe reached the service but TikTok acquisition failed upstream (HTTP 502). Inspect deployment logs; the token itself was accepted.");
  }
  const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "unknown_error";
  throw new Error(`Railway probe returned HTTP ${response.status} (${error}).`);
}

const result = ProbeResponseSchema.parse(await response.json());
if (result.status !== "needs_review" || !result.evidenceTypes.includes("description")) {
  throw new Error("Railway probe did not acquire the expected TikTok URL evidence.");
}

console.log(JSON.stringify(result, null, 2));
