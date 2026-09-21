import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AnalysisResult } from "../domain/models.js";
import { IdempotencyConflictError, IdempotencyInProgressError } from "../persistence/idempotency.js";
import type { AnalysisApiResponse } from "../application/analysis-api-service.js";
import {
  AnalysisPlaceNotFoundError,
  AnalysisPlaceUnverifiedError,
  type SavedPlace,
} from "../application/saved-place-service.js";
import type { BrowserSessionService, ResolvedBrowserSession } from "../application/browser-session-service.js";

export const TIKTOK_ACCEPTANCE_URL = "https://vt.tiktok.com/ZSq4UprxR/";

export interface SourceAnalyzer {
  execute(input: string): Promise<AnalysisResult>;
}

export interface AnalysisApi {
  analyze(userId: string, inputUrl: string, idempotencyKey: string): Promise<AnalysisApiResponse>;
}

export interface SavedPlacesApi {
  confirm(userId: string, analysisId: string, placeId: string): Promise<SavedPlace>;
  list(userId: string): Promise<SavedPlace[]>;
}

export type ProbeServerOptions = {
  analyzer: SourceAnalyzer;
  /**
   * Omitted only when the deployment is misconfigured. In that state health
   * checks remain available, while the probe endpoint fails closed.
   */
  probeToken?: string | undefined;
  /** Temporary operational gate while M2 cost limits are not yet available. */
  apiToken?: string | undefined;
  analysisApi?: AnalysisApi | undefined;
  savedPlacesApi?: SavedPlacesApi | undefined;
  browserSessions?: BrowserSessionService | undefined;
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
  const probeToken = options.probeToken?.trim() || undefined;
  const apiToken = options.apiToken?.trim() || undefined;
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok", probeConfigured: probeToken !== undefined, analysisApiConfigured: Boolean(apiToken && options.analysisApi && options.savedPlacesApi && options.browserSessions) });
      return;
    }

    if (url.pathname === "/v1/analyses") {
      await handleAnalysisApi(request, response, options.analysisApi, options.browserSessions, apiToken);
      return;
    }

    if (url.pathname === "/v1/places") {
      await handleSavedPlacesApi(request, response, options.savedPlacesApi, options.browserSessions, apiToken);
      return;
    }

    const saveMatch = /^\/v1\/analyses\/([^/]+)\/places\/([^/]+)\/save$/.exec(url.pathname);
    if (saveMatch) {
      const analysisId = saveMatch[1];
      const placeId = saveMatch[2];
      if (!analysisId || !placeId) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }
      await handleSavePlaceApi(request, response, options.savedPlacesApi, options.browserSessions, apiToken, analysisId, placeId);
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

    if (!probeToken) {
      writeJson(response, 503, { error: "probe_unavailable" });
      return;
    }

    if (!hasValidBearerToken(request, probeToken)) {
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

async function handleAnalysisApi(request: IncomingMessage, response: ServerResponse, api: AnalysisApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined): Promise<void> {
  if (request.method !== "POST") {
    writeJson(response, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return;
  }
  if (!api || !browserSessions || !apiToken) {
    writeJson(response, 503, { error: "analysis_api_unavailable" });
    return;
  }
  if (!hasValidBearerToken(request, apiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  const idempotencyHeader = request.headers["idempotency-key"];
  const idempotencyKey = typeof idempotencyHeader === "string" ? idempotencyHeader.trim() : undefined;
  if (!idempotencyKey) {
    writeJson(response, 400, { error: "idempotency_key_required" });
    return;
  }
  const body = await readJson(request);
  if (!body || typeof body.url !== "string" || !body.url.trim()) {
    writeJson(response, 400, { error: "invalid_request" });
    return;
  }
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    const output = await api.analyze(session.userId, body.url, idempotencyKey);
    writeJson(response, output.status, { ...output.body, replayed: output.replayed }, sessionHeaders(session));
  } catch (error) {
    if (error instanceof IdempotencyConflictError) writeJson(response, 409, { error: "idempotency_conflict" }, sessionHeaders(session));
    else if (error instanceof IdempotencyInProgressError) writeJson(response, 409, { error: "request_in_progress" }, sessionHeaders(session));
    else writeJson(response, 502, { error: "analysis_failed" }, sessionHeaders(session));
  }
}

async function handleSavedPlacesApi(request: IncomingMessage, response: ServerResponse, api: SavedPlacesApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined): Promise<void> {
  if (request.method !== "GET") {
    writeJson(response, 405, { error: "method_not_allowed" }, { allow: "GET" });
    return;
  }
  if (!api || !browserSessions || !apiToken) {
    writeJson(response, 503, { error: "analysis_api_unavailable" });
    return;
  }
  if (!hasValidBearerToken(request, apiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    writeJson(response, 200, { places: await api.list(session.userId) }, sessionHeaders(session));
  } catch {
    writeJson(response, 502, { error: "saved_places_failed" }, sessionHeaders(session));
  }
}

async function handleSavePlaceApi(
  request: IncomingMessage,
  response: ServerResponse,
  api: SavedPlacesApi | undefined,
  browserSessions: BrowserSessionService | undefined,
  apiToken: string | undefined,
  analysisId: string,
  placeId: string,
): Promise<void> {
  if (request.method !== "POST") {
    writeJson(response, 405, { error: "method_not_allowed" }, { allow: "POST" });
    return;
  }
  if (!api || !browserSessions || !apiToken) {
    writeJson(response, 503, { error: "analysis_api_unavailable" });
    return;
  }
  if (!hasValidBearerToken(request, apiToken)) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    writeJson(response, 200, { place: await api.confirm(session.userId, analysisId, placeId) }, sessionHeaders(session));
  } catch (error) {
    if (error instanceof AnalysisPlaceNotFoundError) writeJson(response, 404, { error: "analysis_place_not_found" }, sessionHeaders(session));
    else if (error instanceof AnalysisPlaceUnverifiedError) writeJson(response, 422, { error: "place_not_verified" }, sessionHeaders(session));
    else writeJson(response, 502, { error: "save_place_failed" }, sessionHeaders(session));
  }
}

async function resolveBrowserSession(request: IncomingMessage, browserSessions: BrowserSessionService): Promise<ResolvedBrowserSession> {
  const cookie = request.headers.cookie;
  return browserSessions.resolve(typeof cookie === "string" ? cookie : undefined);
}

function sessionHeaders(session: ResolvedBrowserSession): Record<string, string> {
  return session.setCookie ? { "set-cookie": session.setCookie } : {};
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) return undefined;
    chunks.push(buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}
