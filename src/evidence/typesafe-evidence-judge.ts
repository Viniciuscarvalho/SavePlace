import { z } from "zod";
import type { CandidateEvidenceSupport, Evidence, PlaceCandidate } from "../domain/models.js";

const endpoint = "https://api.typesafe.ai/v1/systemone";
const model = "jev-1.13.0";
const promptVersion = "m2.4-candidate-evidence-v1";
const inputUsdPerMillionTokens = 0.042;
const minimumConfidence = 0.8;

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.enum(["supports", "ambiguous", "does_not_support"]),
  probabilities: z.object({
    supports: z.number().min(0).max(1),
    ambiguous: z.number().min(0).max(1),
    does_not_support: z.number().min(0).max(1),
  }),
  confidence: z.number().min(0).max(1),
});

const ResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), ChoiceAnswerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

export type EvidenceJudgmentRun = {
  support: CandidateEvidenceSupport[];
  attribution: {
    status: "completed" | "unavailable" | "failed";
    provider: "typesafe";
    model: string;
    promptVersion: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
};

export type CandidateEvidenceJudge = {
  judge(candidates: PlaceCandidate[], evidence: Evidence[]): Promise<EvidenceJudgmentRun>;
};

type TypeSafeEvidenceJudgeOptions = {
  apiKey?: string | undefined;
  fetchFn?: typeof fetch;
};

export class TypeSafeEvidenceJudge implements CandidateEvidenceJudge {
  private readonly apiKey: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor({ apiKey, fetchFn = fetch }: TypeSafeEvidenceJudgeOptions = {}) {
    this.apiKey = apiKey?.trim() || undefined;
    this.fetchFn = fetchFn;
  }

  async judge(candidates: PlaceCandidate[], evidence: Evidence[]): Promise<EvidenceJudgmentRun> {
    const startedAt = performance.now();
    if (!this.apiKey) return this.unavailable(candidates, startedAt);

    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          state: {
            evidence: evidence.map(({ type, text }) => ({ type, text })),
            candidates: candidates.map(({ rawName, normalizedName, cityHint, neighborhoodHint, countryHint, evidence: candidateEvidence }) => ({
              rawName, ...(normalizedName ? { normalizedName } : {}), ...(cityHint ? { cityHint } : {}),
              ...(neighborhoodHint ? { neighborhoodHint } : {}), ...(countryHint ? { countryHint } : {}),
              evidence: candidateEvidence.map(({ type, text }) => ({ type, text })),
            })),
          },
          questions: Object.fromEntries(candidates.map((_, index) => [`candidate_${index}`, {
            type: "choice",
            instructions: `Does candidates[${index}] have explicit support in its evidence and state.evidence? This is only a support signal; never infer an address or geographic verification.`,
            criteria: {
              supports: "The acquired evidence explicitly identifies this candidate and is consistent with its supplied hints.",
              ambiguous: "The evidence is incomplete, indirect, mixed, or cannot distinguish this candidate reliably.",
              does_not_support: "The evidence does not identify this candidate or materially contradicts it.",
            },
          }])),
        }),
      });
      if (!response.ok) return this.failed(candidates, startedAt);

      const parsed = ResponseSchema.safeParse(await response.json());
      if (!parsed.success) return this.failed(candidates, startedAt);
      if (candidates.some((_, candidateIndex) => !parsed.data.answers[`candidate_${candidateIndex}`])) {
        return this.failed(candidates, startedAt);
      }
      const support = candidates.map((_, candidateIndex) => {
        const answer = parsed.data.answers[`candidate_${candidateIndex}`]!;
        return {
          candidateIndex,
          status: answer.confidence >= minimumConfidence ? answer.choice : "ambiguous" as const,
          confidence: answer.confidence,
          probabilities: answer.probabilities,
        };
      });
      return {
        support,
        attribution: {
          status: "completed", provider: "typesafe", model: parsed.data.model, promptVersion,
          durationMs: performance.now() - startedAt, inputTokens: parsed.data.usage.input_tokens,
          outputTokens: parsed.data.usage.output_tokens,
          estimatedCostUsd: parsed.data.usage.input_tokens * inputUsdPerMillionTokens / 1_000_000,
        },
      };
    } catch {
      return this.failed(candidates, startedAt);
    }
  }

  private unavailable(candidates: PlaceCandidate[], startedAt: number): EvidenceJudgmentRun {
    return this.unavailableRun(candidates, startedAt, "unavailable");
  }

  private failed(candidates: PlaceCandidate[], startedAt: number): EvidenceJudgmentRun {
    return this.unavailableRun(candidates, startedAt, "failed");
  }

  private unavailableRun(candidates: PlaceCandidate[], startedAt: number, status: "unavailable" | "failed"): EvidenceJudgmentRun {
    return {
      support: candidates.map((_, candidateIndex) => ({ candidateIndex, status: "unavailable" })),
      attribution: { status, provider: "typesafe", model, promptVersion, durationMs: performance.now() - startedAt, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    };
  }
}
