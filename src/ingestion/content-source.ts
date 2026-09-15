import type { AcquisitionResult } from "../domain/models.js";

export interface ContentSource {
  canHandle(input: string): boolean;
  acquire(input: string): Promise<AcquisitionResult>;
}

export class ContentSourceRouter {
  constructor(private readonly sources: ContentSource[]) {}

  async acquire(input: string): Promise<AcquisitionResult> {
    const source = this.sources.find((candidate) => candidate.canHandle(input));
    if (!source) {
      return { status: "unsupported", reason: "No content-source adapter can handle this input yet." };
    }
    return source.acquire(input);
  }
}
