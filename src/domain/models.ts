import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "instagram", "tiktok", "web", "unknown"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const PlaceCategorySchema = z.enum(["FOOD", "TRAVEL", "OTHER"]);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

export const EvidenceSchema = z.object({
  type: z.enum(["title", "description", "author", "thumbnail", "embed", "transcript", "page_metadata"]),
  text: z.string().min(1),
  sourceUrl: z.string().url().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const PlaceCandidateSchema = z.object({
  rawName: z.string().min(1),
  normalizedName: z.string().min(1).optional(),
  category: PlaceCategorySchema,
  subcategory: z.string().min(1).optional(),
  cityHint: z.string().min(1).optional(),
  neighborhoodHint: z.string().min(1).optional(),
  countryHint: z.string().min(1).optional(),
  extractionConfidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export type PlaceCandidate = z.infer<typeof PlaceCandidateSchema>;

export const ResolvedPlaceSchema = z.object({
  name: z.string(), normalizedName: z.string(), category: PlaceCategorySchema,
  subcategory: z.string().optional(), address: z.string(), city: z.string(),
  state: z.string().optional(), country: z.string(), latitude: z.number(), longitude: z.number(),
  provider: z.string(), providerPlaceId: z.string(), extractionConfidence: z.number().min(0).max(1),
  resolutionConfidence: z.number().min(0).max(1), overallConfidence: z.number().min(0).max(1), verified: z.literal(true),
});
export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

/** Keeps the provider-verified identity attached to the exact extracted candidate. */
export type AnalysisPlaceMention = {
  candidate: PlaceCandidate;
  place?: ResolvedPlace;
};

export type ProviderUsage = {
  provider: string;
  operation: string;
  requests: number;
  billableUnits: number;
  estimatedCostUsd: number | null;
  costStatus: "estimated" | "pricing_not_configured";
  pricingSource?: string;
  pricingEffectiveDate?: string;
};

export type SourceEvidence = {
  input: string;
  canonicalUrl: string;
  contentId?: string;
  platform: Platform;
  author?: string;
  title?: string;
  description?: string;
  thumbnailUrl?: string;
  evidence: Evidence[];
};

export type AcquisitionResult =
  | { status: "acquired"; source: SourceEvidence }
  | { status: "insufficient_evidence"; platform: Platform; canonicalUrl?: string; reason: string }
  | { status: "unsupported"; reason: string };

export type AnalysisResult = {
  status: "completed" | "insufficient_evidence" | "needs_review" | "failed";
  source: { input: string; platform: Platform; canonicalUrl?: string; contentId?: string };
  evidence: Evidence[];
  candidates: PlaceCandidate[];
  places: ResolvedPlace[];
  /** Optional while legacy M0 fixture results remain readable. New pipeline runs always populate it. */
  mentions?: AnalysisPlaceMention[];
  processing: {
    extractionMethod: "url_metadata" | "transcript" | "visual" | "multimodal" | "none";
    durationMs: number;
    extraction?: {
      status: "completed" | "unavailable" | "failed";
      provider: string;
      model: string;
      promptVersion: string;
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    };
    resolution?: {
      provider: string;
      requestCount: number;
      /** Undefined means the provider request was made but is not costed locally. */
      estimatedCostUsd?: number;
      unpricedRequestCount: number;
      usage: ProviderUsage[];
    };
  };
  reason?: string;
  nextAction?: "review";
};
