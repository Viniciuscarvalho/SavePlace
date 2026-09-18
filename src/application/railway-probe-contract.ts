import { z } from "zod";

export const RailwayProbeResponseSchema = z.object({
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

export type RailwayProbeResponse = z.infer<typeof RailwayProbeResponseSchema>;

/**
 * The fixed Railway probe proves that TikTok exposed useful URL metadata in
 * the target runtime. A configured LLM/PlaceProvider can legitimately turn
 * that same evidence into a completed result; a non-configured pipeline keeps
 * it in needs_review. Both outcomes prove acquisition without exposing data.
 */
export function hasExpectedTikTokEvidence(result: RailwayProbeResponse): boolean {
  return (result.status === "completed" || result.status === "needs_review")
    && result.evidenceTypes.includes("description");
}
