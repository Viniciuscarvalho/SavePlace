import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AnalysisResult } from "../domain/models.js";

export const TIKTOK_ACCEPTANCE_URL = "https://vt.tiktok.com/ZSq4UprxR/";

export interface SourceAnalyzer {
  execute(input: string): Promise<AnalysisResult>;
}

export type ProbeServerOptions = {
  analyzer: SourceAnalyzer;
  probeToken: string;
  acceptanceUrl?: string;
};

type ProbeResponse = {
  status: AnalysisResult["status"];
  source: AnalysisResult["source"];
  evidenceTypes: AnalysisResult["evidence"][number]["type"][];
  candidateCount: number;
  placeCount: number;
  extractionMethod: AnalysisResult["processing"]["extractionMethod"];
};

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(JSON.stringify(body));
}

function hasValidBearerToken(request: IncomingMessage, expectedToken: string): boolean {
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(request.headers.authorization ?? "");
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

function toProbeResponse(result: AnalysisResult): ProbeResponse {
  return {
    status: result.status,
    source: result.source,
    evidenceTypes: result.evidence.map((evidence) => evidence.type),
    candidateCount: result.candidates.length,
    placeCount: result.places.length,
    extractionMethod: result.processing.extractionMethod,
  };
}

/**
 * A deliberately narrow HTTP shell used only to prove target-runtime egress.
 * It accepts no source URL, so it cannot become an unauthenticated fetch proxy.
 */
export function createProbeServer(options: ProbeServerOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (url.pathname !== "/internal/probes/tiktok") {
      writeJson(response, 404, { error: "not_found" });
      return;
    }

    if (request.method !== "POST") {
      writeJson(response, 405, { error: "method_not_allowed" }, { allow: "POST" });
      return;
    }

    if (!hasValidBearerToken(request, options.probeToken)) {
      writeJson(response, 401, { error: "unauthorized" });
      return;
    }

    try {
      const result = await options.analyzer.execute(options.acceptanceUrl ?? TIKTOK_ACCEPTANCE_URL);
      writeJson(response, 200, toProbeResponse(result));
    } catch {
      writeJson(response, 502, { error: "probe_failed" });
    }
  });
}
