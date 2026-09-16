import { z } from "zod";
import type { Evidence, PlaceCandidate, SourceEvidence } from "../domain/models.js";

export type ExtractionAttribution = {
  provider: "openai";
  model: string;
  promptVersion: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type ExtractionRun = {
  status: "completed" | "unavailable" | "failed";
  candidates: PlaceCandidate[];
  attribution: ExtractionAttribution;
};

export interface PlaceExtractor {
  extract(source: SourceEvidence): Promise<PlaceCandidate[]>;
}

/**
 * Optional extension for callers that need a durable analysis record. The
 * existing pipeline intentionally consumes only candidates while M0 remains a
 * CLI, so it is not forced to know an AI provider's accounting shape.
 */
export interface AuditablePlaceExtractor extends PlaceExtractor {
  extractWithTrace(source: SourceEvidence): Promise<ExtractionRun>;
}

/**
 * Baseline used to wire and test the M0 pipeline before choosing an LLM.
 * It deliberately returns no guesses: precision is the first priority.
 */
export class NoGuessPlaceExtractor implements PlaceExtractor {
  async extract(_source: SourceEvidence): Promise<PlaceCandidate[]> {
    return [];
  }
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_PROMPT_VERSION = "m0.3-url-evidence-v4";
const DEFAULT_MAX_CANDIDATES = 5;
const DEFAULT_INPUT_USD_PER_MILLION_TOKENS = 0.2;
const DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS = 1.2;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_EVIDENCE_CHARS_PER_ITEM = 4_000;
const MAX_EVIDENCE_CHARS_PER_REQUEST = 8_000;

const LlmCandidateSchema = z.object({
  rawName: z.string().trim().min(1).max(120),
  entityKind: z.enum(["venue", "attraction", "area"]),
  normalizedName: z.string().trim().min(1).max(120).nullable(),
  category: z.enum(["FOOD", "TRAVEL", "OTHER"]),
  subcategory: z.string().trim().min(1).max(80).nullable(),
  cityHint: z.string().trim().min(1).max(100).nullable(),
  neighborhoodHint: z.string().trim().min(1).max(100).nullable(),
  countryHint: z.string().trim().min(1).max(100).nullable(),
  extractionConfidence: z.number().min(0).max(1),
  evidenceIndices: z.array(z.number().int().nonnegative()).min(1).max(3),
});

const LlmResponseSchema = z.object({
  candidates: z.array(LlmCandidateSchema).max(DEFAULT_MAX_CANDIDATES),
});

const OpenAIResponseSchema = z.object({
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().min(1).optional(),
    })).default([]),
  })).default([]),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
  }).optional(),
});

export type OpenAIPlaceExtractorOptions = {
  /** The optional key keeps the M0 CLI usable without an AI provider. */
  apiKey?: string;
  model?: string;
  promptVersion?: string;
  maxCandidates?: number;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

type LlmCandidate = z.infer<typeof LlmCandidateSchema>;

function canonicalText(value: string): string {
  return value.normalize("NFKD").replace(/\p{Mark}/gu, "").toLocaleLowerCase();
}

function appearsInEvidence(value: string, evidence: Evidence[]): boolean {
  const expected = canonicalText(value);
  return evidence.some((item) => canonicalText(item.text).includes(expected));
}

function optionalLiteral(value: string | null, evidence: Evidence[]): string | undefined {
  return value !== null && appearsInEvidence(value, evidence) ? value : undefined;
}

/** Normalizes an observed social handle without introducing new words. */
function normalizedObservedHandle(value: string): string | undefined {
  if (!value.startsWith("@")) return undefined;
  const normalized = value.slice(1).replace(/[._-]+/g, " ").replace(/\bofficial\b/gi, "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

/**
 * The LLM confidence is an input, never the whole score. A candidate can only
 * reach a high confidence when the acquired evidence contains independent,
 * literal location signals. This ceiling is intentionally conservative.
 */
export function calibrateExtractionConfidence(modelConfidence: number, evidence: Evidence[], hints: {
  cityHint?: string | undefined;
  neighborhoodHint?: string | undefined;
  countryHint?: string | undefined;
}): number {
  const evidenceSupport = Math.min(evidence.length, 3) * 0.1;
  const locationSignals = [hints.cityHint, hints.neighborhoodHint, hints.countryHint].filter(Boolean).length;
  const locationSupport = Math.min(locationSignals, 3) * 0.1;
  const observableCeiling = Math.min(0.95, 0.55 + evidenceSupport + locationSupport);
  return Math.min(modelConfidence, observableCeiling);
}

function materializeCandidate(candidate: LlmCandidate, sourceEvidence: Evidence[]): PlaceCandidate | null {
  if (candidate.entityKind === "area") return null;
  const evidenceIndices = [...new Set(candidate.evidenceIndices)];
  const evidence = evidenceIndices.map((index) => sourceEvidence[index]).filter((item): item is Evidence => item !== undefined);
  if (evidence.length !== evidenceIndices.length || !appearsInEvidence(candidate.rawName, evidence)) return null;

  // Hints are useful to the resolver only if they were literally exposed by
  // the source. The model may classify evidence, but it cannot fabricate it.
  const literalNormalizedName = optionalLiteral(candidate.normalizedName, evidence);
  const normalizedName = literalNormalizedName?.startsWith("@")
    ? normalizedObservedHandle(candidate.rawName)
    : literalNormalizedName ?? normalizedObservedHandle(candidate.rawName);
  const subcategory = optionalLiteral(candidate.subcategory, evidence);
  const cityHint = optionalLiteral(candidate.cityHint, evidence);
  const neighborhoodHint = optionalLiteral(candidate.neighborhoodHint, evidence);
  const countryHint = optionalLiteral(candidate.countryHint, evidence);
  const candidateName = canonicalText(candidate.rawName).trim();
  if ([cityHint, neighborhoodHint, countryHint].some((hint) => hint !== undefined && canonicalText(hint).trim() === candidateName)) {
    return null;
  }

  return {
    rawName: candidate.rawName,
    ...(normalizedName ? { normalizedName } : {}),
    category: candidate.category,
    ...(subcategory ? { subcategory } : {}),
    ...(cityHint ? { cityHint } : {}),
    ...(neighborhoodHint ? { neighborhoodHint } : {}),
    ...(countryHint ? { countryHint } : {}),
    extractionConfidence: calibrateExtractionConfidence(candidate.extractionConfidence, evidence, { cityHint, neighborhoodHint, countryHint }),
    evidence,
  };
}

function structuredOutputSchema(maxCandidates: number): Record<string, unknown> {
  const nullableString = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "rawName", "normalizedName", "category", "subcategory", "cityHint",
            "neighborhoodHint", "countryHint", "entityKind", "extractionConfidence", "evidenceIndices",
          ],
          properties: {
            rawName: { type: "string", minLength: 1, maxLength: 120 },
            entityKind: { type: "string", enum: ["venue", "attraction", "area"] },
            normalizedName: nullableString,
            category: { type: "string", enum: ["FOOD", "TRAVEL", "OTHER"] },
            subcategory: nullableString,
            cityHint: nullableString,
            neighborhoodHint: nullableString,
            countryHint: nullableString,
            extractionConfidence: { type: "number", minimum: 0, maximum: 1 },
            evidenceIndices: {
              type: "array", minItems: 1, maxItems: 3,
              items: { type: "integer", minimum: 0 },
            },
          },
        },
      },
    },
  };
}

function promptFor(source: SourceEvidence, promptVersion: string): string {
  let remainingChars = MAX_EVIDENCE_CHARS_PER_REQUEST;
  const evidence = extractableEvidence(source.evidence).flatMap(({ item, sourceIndex }) => {
    if (remainingChars <= 0) return [];
    const text = item.text.slice(0, Math.min(MAX_EVIDENCE_CHARS_PER_ITEM, remainingChars));
    remainingChars -= text.length;
    return [{ index: sourceIndex, type: item.type, text }];
  });
  return [
    `Prompt version: ${promptVersion}.`,
    "Extract 0 to 5 specifically named venue or attraction candidates from the literal source evidence below.",
    "A restaurant, bar, cafe, hotel, shop, museum, beach, landmark, or named attraction is a candidate. A city, neighborhood, state, country, or generic area is only a location hint and must use entityKind area; area candidates are discarded even when capitalized.",
    "For a list of named venues, return each distinct venue or attraction (up to five). Do not return a generic area merely because the evidence mentions it.",
    "Do not infer image content, use outside knowledge, or invent names, hints, or evidence.",
    "rawName and every non-null hint must appear literally in its selected evidence. Use null when a field is not explicitly present.",
    "Return an empty candidates array when the evidence is ambiguous or does not explicitly name a place.",
    "Evidence:",
    JSON.stringify({ canonicalUrl: source.canonicalUrl, platform: source.platform, evidence }),
  ].join("\n");
}

function extractableEvidence(evidence: Evidence[]): Array<{ item: Evidence; sourceIndex: number }> {
  const types = new Set<Evidence["type"]>(["title", "description", "page_metadata", "transcript"]);
  return evidence.flatMap((item, sourceIndex) => types.has(item.type) ? [{ item, sourceIndex }] : []);
}

function attribution(
  model: string,
  promptVersion: string,
  startedAt: number,
  inputTokens = 0,
  outputTokens = 0,
  inputUsdPerMillionTokens = DEFAULT_INPUT_USD_PER_MILLION_TOKENS,
  outputUsdPerMillionTokens = DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS,
): ExtractionAttribution {
  return {
    provider: "openai",
    model,
    promptVersion,
    durationMs: performance.now() - startedAt,
    inputTokens,
    outputTokens,
    estimatedCostUsd: (inputTokens * inputUsdPerMillionTokens + outputTokens * outputUsdPerMillionTokens) / 1_000_000,
  };
}

/**
 * Minimal OpenAI adapter for M0 URL metadata. It asks for JSON Schema output,
 * then verifies every selected evidence pointer against locally acquired
 * evidence before a candidate can reach a PlaceProvider.
 */
export class OpenAIPlaceExtractor implements AuditablePlaceExtractor {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly promptVersion: string;
  private readonly maxCandidates: number;
  private readonly inputUsdPerMillionTokens: number;
  private readonly outputUsdPerMillionTokens: number;
  private readonly timeoutMs: number;
  private readonly http: typeof fetch;

  constructor(options: OpenAIPlaceExtractorOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.model = options.model ?? DEFAULT_MODEL;
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION;
    this.maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
    this.inputUsdPerMillionTokens = options.inputUsdPerMillionTokens ?? DEFAULT_INPUT_USD_PER_MILLION_TOKENS;
    this.outputUsdPerMillionTokens = options.outputUsdPerMillionTokens ?? DEFAULT_OUTPUT_USD_PER_MILLION_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.http = options.fetchFn ?? fetch;

    if (!Number.isInteger(this.maxCandidates) || this.maxCandidates < 1 || this.maxCandidates > DEFAULT_MAX_CANDIDATES) {
      throw new Error(`maxCandidates must be between 1 and ${DEFAULT_MAX_CANDIDATES}.`);
    }
    if (this.inputUsdPerMillionTokens < 0 || this.outputUsdPerMillionTokens < 0) {
      throw new Error("Token prices must be non-negative.");
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60_000) {
      throw new Error("timeoutMs must be an integer between 1 and 60000.");
    }
  }

  async extract(source: SourceEvidence): Promise<PlaceCandidate[]> {
    return (await this.extractWithTrace(source)).candidates;
  }

  async extractWithTrace(source: SourceEvidence): Promise<ExtractionRun> {
    const startedAt = performance.now();
    const prices = [this.inputUsdPerMillionTokens, this.outputUsdPerMillionTokens] as const;
    const empty = (status: ExtractionRun["status"], inputTokens = 0, outputTokens = 0): ExtractionRun => ({
      status,
      candidates: [],
      attribution: attribution(this.model, this.promptVersion, startedAt, inputTokens, outputTokens, ...prices),
    });

    if (!this.apiKey) return empty("unavailable");
    if (extractableEvidence(source.evidence).length === 0) return empty("completed");

    try {
      const response = await this.http(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          model: this.model,
          max_output_tokens: 700,
          input: [
            { role: "system", content: [{ type: "input_text", text: "You extract conservative place candidates from supplied evidence only." }] },
            { role: "user", content: [{ type: "input_text", text: promptFor(source, this.promptVersion) }] },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "saveplace_candidates",
              strict: true,
              schema: structuredOutputSchema(this.maxCandidates),
            },
          },
        }),
      });
      if (!response.ok) return empty("failed");

      const parsedResponse = OpenAIResponseSchema.safeParse(await response.json());
      if (!parsedResponse.success) return empty("failed");
      const usage = parsedResponse.data.usage;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      const content = parsedResponse.data.output
        .flatMap((output) => output.content)
        .find((part) => part.type === "output_text")?.text;
      if (!content) return empty("failed", inputTokens, outputTokens);

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(content);
      } catch {
        return empty("failed", inputTokens, outputTokens);
      }
      const parsedCandidates = LlmResponseSchema.safeParse(parsedContent);
      if (!parsedCandidates.success) return empty("failed", inputTokens, outputTokens);

      const candidates = parsedCandidates.data.candidates
        .map((candidate) => materializeCandidate(candidate, source.evidence))
        .filter((candidate): candidate is PlaceCandidate => candidate !== null)
        .filter((candidate, index, all) => all.findIndex((other) => canonicalText(other.rawName) === canonicalText(candidate.rawName)) === index);
      return {
        status: "completed",
        candidates,
        attribution: attribution(this.model, this.promptVersion, startedAt, inputTokens, outputTokens, ...prices),
      };
    } catch {
      // Network/provider failures must fail closed and never log credentials.
      return empty("failed");
    }
  }
}
