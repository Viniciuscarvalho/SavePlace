import { describe, expect, it, vi } from "vitest";
import type { Evidence, PlaceCandidate } from "../src/domain/models.js";
import { TypeSafeEvidenceJudge } from "../src/evidence/typesafe-evidence-judge.js";

const evidence: Evidence[] = [{ type: "description", text: "Madre em São Paulo" }];
const candidates: PlaceCandidate[] = [
  { rawName: "Madre", category: "FOOD", extractionConfidence: 0.96, evidence },
  { rawName: "Outro", category: "FOOD", extractionConfidence: 0.5, evidence },
];

describe("TypeSafeEvidenceJudge", () => {
  it("batches candidates and gates low-confidence support to ambiguous", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "jev-1.13.0",
      answers: {
        candidate_0: { type: "choice", choice: "supports", confidence: 0.91, probabilities: { supports: 0.94, ambiguous: 0.04, does_not_support: 0.02 } },
        candidate_1: { type: "choice", choice: "does_not_support", confidence: 0.4, probabilities: { supports: 0.2, ambiguous: 0.35, does_not_support: 0.45 } },
      },
      usage: { input_tokens: 500, output_tokens: 30 },
    }), { status: 200 }));

    const result = await new TypeSafeEvidenceJudge({ apiKey: "test-key", fetchFn }).judge(candidates, evidence);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "jev-1.13.0", questions: { candidate_0: { type: "choice" }, candidate_1: { type: "choice" } },
    });
    expect(result.support).toEqual([
      { candidateIndex: 0, status: "supports", confidence: 0.91, probabilities: { supports: 0.94, ambiguous: 0.04, does_not_support: 0.02 } },
      { candidateIndex: 1, status: "ambiguous", confidence: 0.4, probabilities: { supports: 0.2, ambiguous: 0.35, does_not_support: 0.45 } },
    ]);
    expect(result.attribution).toMatchObject({ status: "completed", inputTokens: 500, outputTokens: 30, estimatedCostUsd: 0.000021 });
  });

  it("does not call TypeSafe without a server-side key", async () => {
    const fetchFn = vi.fn<typeof fetch>();

    await expect(new TypeSafeEvidenceJudge({ fetchFn }).judge(candidates, evidence)).resolves.toMatchObject({
      support: [{ status: "unavailable" }, { status: "unavailable" }],
      attribution: { status: "unavailable", inputTokens: 0, estimatedCostUsd: 0 },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
