import { z } from "zod";

export const PlatformSchema = z.enum(["youtube", "instagram", "tiktok", "web", "upload", "unknown"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const PlaceCategorySchema = z.enum(["FOOD", "TRAVEL", "OTHER"]);
export type PlaceCategory = z.infer<typeof PlaceCategorySchema>;

export const EvidenceSchema = z.object({
  type: z.enum(["metadata", "caption", "transcript", "frame", "user_input"]),
  text: z.string().min(1),
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
  name: z.string(),
  normalizedName: z.string(),
  category: PlaceCategorySchema,
  subcategory: z.string().optional(),
  address: z.string(),
  city: z.string(),
  state: z.string().optional(),
  country: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  provider: z.string(),
  providerPlaceId: z.string(),
  extractionConfidence: z.number().min(0).max(1),
  resolutionConfidence: z.number().min(0).max(1),
  overallConfidence: z.number().min(0).max(1),
  verified: z.literal(true),
});
export type ResolvedPlace = z.infer<typeof ResolvedPlaceSchema>;

export type SourceEvidence = {
  input: string;
  platform: Platform;
  caption?: string;
  title?: string;
  transcript?: string;
  evidence: Evidence[];
};

export type AcquisitionResult =
  | { status: "acquired"; source: SourceEvidence }
  | { status: "media_required"; platform: Platform; reason: string; nextAction: "upload_video" }
  | { status: "unsupported"; reason: string };

export type AnalysisResult = {
  status: "completed" | "media_required" | "needs_review" | "failed";
  source: { input: string; platform: Platform };
  candidates: PlaceCandidate[];
  places: ResolvedPlace[];
  processing: {
    extractionMethod: "metadata" | "transcript" | "frames" | "multimodal" | "none";
    durationMs: number;
  };
  reason?: string;
  nextAction?: "upload_video" | "review";
};
