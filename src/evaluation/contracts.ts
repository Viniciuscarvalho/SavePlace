import { z } from "zod";
import { EvidenceSchema, PlaceCandidateSchema, PlaceCategorySchema, ResolvedPlaceSchema } from "../domain/models.js";

const DecisionSchema = z.enum(["completed", "needs_review", "insufficient_evidence", "failed"]);
const AcquisitionSchema = z.enum(["acquired", "insufficient_evidence", "unsupported"]);

export const ExpectedCandidateSchema = z.object({
  name: z.string().min(1),
  category: PlaceCategorySchema.optional(),
  city: z.string().min(1).optional(),
});

export const ExpectedPlaceSchema = ExpectedCandidateSchema.extend({
  provider: z.string().min(1).optional(),
  providerPlaceId: z.string().min(1).optional(),
  /** False when the ground truth is known but M0 should deliberately retain review. */
  resolutionExpected: z.boolean().default(true),
});

export const EvaluationCaseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]+$/),
  input: z.string().url(),
  platform: z.enum(["tiktok", "youtube"]),
  live: z.boolean(),
  fixture: z.string().regex(/^[-a-zA-Z0-9_/.]+\.json$/).refine((value) => !value.includes(".."), "fixture path must stay inside evals/fixtures"),
  expected: z.object({
    acquisition: AcquisitionSchema,
    decision: DecisionSchema,
    manualStatus: z.enum(["verified", "pending"]),
    candidates: z.array(ExpectedCandidateSchema),
    places: z.array(ExpectedPlaceSchema),
  }),
  notes: z.string().min(1),
});
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;

const ProcessingSchema = z.object({
  extractionMethod: z.enum(["url_metadata", "transcript", "visual", "multimodal", "none"]),
  durationMs: z.number().nonnegative(),
  extraction: z.object({
    status: z.enum(["completed", "unavailable", "failed"]),
    provider: z.string().min(1),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    durationMs: z.number().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  }).optional(),
  resolution: z.object({
    provider: z.string().min(1),
    requestCount: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    unpricedRequestCount: z.number().int().nonnegative(),
    usage: z.array(z.object({
      provider: z.string().min(1),
      operation: z.string().min(1),
      requests: z.number().int().nonnegative(),
      billableUnits: z.number().int().nonnegative(),
      estimatedCostUsd: z.number().nonnegative().nullable(),
      costStatus: z.enum(["estimated", "pricing_not_configured"]),
      pricingSource: z.string().min(1).optional(),
      pricingEffectiveDate: z.string().min(1).optional(),
    })).optional(),
  }).optional(),
});

export const EvaluationAnalysisSchema = z.object({
  status: DecisionSchema,
  source: z.object({
    input: z.string(),
    platform: z.enum(["youtube", "instagram", "tiktok", "web", "unknown"]),
    canonicalUrl: z.string().url().optional(),
    contentId: z.string().optional(),
  }),
  evidence: z.array(EvidenceSchema),
  candidates: z.array(PlaceCandidateSchema),
  places: z.array(ResolvedPlaceSchema),
  processing: ProcessingSchema,
  reason: z.string().optional(),
  nextAction: z.literal("review").optional(),
});
export type EvaluationAnalysis = z.infer<typeof EvaluationAnalysisSchema>;

export const EvaluationFixtureSchema = z.object({
  acquisition: AcquisitionSchema,
  analysis: EvaluationAnalysisSchema,
});
export type EvaluationFixture = z.infer<typeof EvaluationFixtureSchema>;

export type EvaluationObservation = {
  evaluationCase: EvaluationCase;
  acquisition: z.infer<typeof AcquisitionSchema>;
  analysis: EvaluationAnalysis;
};
