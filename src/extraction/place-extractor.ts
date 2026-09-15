import type { PlaceCandidate, SourceEvidence } from "../domain/models.js";

export interface PlaceExtractor {
  extract(source: SourceEvidence): Promise<PlaceCandidate[]>;
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
