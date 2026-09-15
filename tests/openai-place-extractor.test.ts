import { describe, expect, it, vi } from "vitest";
import type { SourceEvidence } from "../src/domain/models.js";
import { OpenAIPlaceExtractor } from "../src/extraction/place-extractor.js";

const source: SourceEvidence = {
  input: "https://vt.tiktok.com/example/",
  canonicalUrl: "https://www.tiktok.com/@creator/video/123",
  contentId: "123",
  platform: "tiktok",
  evidence: [
    { type: "description", text: "Conheça o Madre em Pinheiros, São Paulo, Brasil." },
    { type: "author", text: "Creator Name" },
    { type: "thumbnail", text: "TikTok cover image" },
  ],
};

function successfulResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(content) }] }],
    usage: { input_tokens: 120, output_tokens: 30 },
  }), { status: 200 });
}

describe("OpenAIPlaceExtractor", () => {
  it("uses Responses structured output and maps evidence indices back to acquired evidence", async () => {
    const fetchFn = vi.fn().mockResolvedValue(successfulResponse({
      candidates: [{
        rawName: "Madre",
        normalizedName: null,
        category: "FOOD",
        subcategory: null,
        cityHint: "São Paulo",
        neighborhoodHint: "Pinheiros",
        countryHint: "Brasil",
        extractionConfidence: 0.91,
        evidenceIndices: [0],
      }],
    }));
    const extractor = new OpenAIPlaceExtractor({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });

    const result = await extractor.extractWithTrace(source);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, request] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(request).toMatchObject({ method: "POST" });
    expect((request.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(request.body as string);
    expect(body.model).toBe("gpt-5.6-luna");
    expect(body.tools).toBeUndefined();
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "saveplace_candidates" });
    expect(body.input[1].content[0].text).toContain("Conheça o Madre");
    expect(body.input[1].content[0].text).not.toContain("Creator Name");
    expect(body.input[1].content[0].text).not.toContain("TikTok cover image");
    expect(result).toMatchObject({
      status: "completed",
      candidates: [{ rawName: "Madre", cityHint: "São Paulo", neighborhoodHint: "Pinheiros", countryHint: "Brasil" }],
      attribution: {
        provider: "openai", model: "gpt-5.6-luna", promptVersion: "m0.3-url-evidence-v1",
        inputTokens: 120, outputTokens: 30, estimatedCostUsd: 0.00006,
      },
    });
    expect(result.candidates[0]?.evidence).toEqual([source.evidence[0]]);
  });

  it("fails closed when the model names a place absent from its selected evidence", async () => {
    const fetchFn = vi.fn().mockResolvedValue(successfulResponse({
      candidates: [{
        rawName: "Invented Cafe",
        normalizedName: null,
        category: "FOOD",
        subcategory: null,
        cityHint: null,
        neighborhoodHint: null,
        countryHint: null,
        extractionConfidence: 0.99,
        evidenceIndices: [0],
      }],
    }));
    const extractor = new OpenAIPlaceExtractor({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });

    await expect(extractor.extractWithTrace(source)).resolves.toMatchObject({ status: "completed", candidates: [] });
  });

  it("fails closed when the model references an evidence index that was not acquired", async () => {
    const fetchFn = vi.fn().mockResolvedValue(successfulResponse({
      candidates: [{
        rawName: "Madre",
        normalizedName: null,
        category: "FOOD",
        subcategory: null,
        cityHint: null,
        neighborhoodHint: null,
        countryHint: null,
        extractionConfidence: 0.9,
        evidenceIndices: [99],
      }],
    }));
    const extractor = new OpenAIPlaceExtractor({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });

    await expect(extractor.extractWithTrace(source)).resolves.toMatchObject({ status: "completed", candidates: [] });
  });

  it("does not call OpenAI when no key is configured", async () => {
    const fetchFn = vi.fn();
    const extractor = new OpenAIPlaceExtractor({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(extractor.extractWithTrace(source)).resolves.toMatchObject({
      status: "unavailable",
      candidates: [],
      attribution: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not spend a request when there is no extractable text evidence", async () => {
    const fetchFn = vi.fn();
    const extractor = new OpenAIPlaceExtractor({ apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch });
    const noTextEvidence: SourceEvidence = { ...source, evidence: [{ type: "thumbnail", text: "TikTok cover image" }] };

    await expect(extractor.extractWithTrace(noTextEvidence)).resolves.toMatchObject({ status: "completed", candidates: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    ["non-success response", vi.fn().mockResolvedValue(new Response("", { status: 429 }))],
    ["invalid provider JSON", vi.fn().mockResolvedValue(new Response("not json", { status: 200 }))],
    ["network error", vi.fn().mockRejectedValue(new Error("network unavailable"))],
  ])("returns no candidates on %s without throwing", async (_scenario, fetchFn) => {
    const extractor = new OpenAIPlaceExtractor({ apiKey: "test-key", fetchFn: fetchFn as typeof fetch });
    await expect(extractor.extractWithTrace(source)).resolves.toMatchObject({ status: "failed", candidates: [] });
  });
});
