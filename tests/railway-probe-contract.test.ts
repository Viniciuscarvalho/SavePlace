import { describe, expect, it } from "vitest";
import { hasExpectedTikTokEvidence, type RailwayProbeResponse } from "../src/application/railway-probe-contract.js";

const acquiredProbeResult: RailwayProbeResponse = {
  status: "needs_review",
  source: {
    platform: "tiktok",
    canonicalUrl: "https://www.tiktok.com/@creator/video/123",
    contentId: "123",
  },
  evidenceTypes: ["description", "author"],
  candidateCount: 0,
  placeCount: 0,
  extractionMethod: "url_metadata",
};

describe("Railway TikTok probe contract", () => {
  it.each(["needs_review", "completed"] as const)("accepts %s when TikTok description evidence was acquired", (status) => {
    expect(hasExpectedTikTokEvidence({ ...acquiredProbeResult, status })).toBe(true);
  });

  it("rejects incomplete or unproven acquisition", () => {
    expect(hasExpectedTikTokEvidence({ ...acquiredProbeResult, status: "insufficient_evidence" })).toBe(false);
    expect(hasExpectedTikTokEvidence({ ...acquiredProbeResult, status: "failed" })).toBe(false);
    expect(hasExpectedTikTokEvidence({ ...acquiredProbeResult, status: "completed", evidenceTypes: ["author"] })).toBe(false);
  });
});
