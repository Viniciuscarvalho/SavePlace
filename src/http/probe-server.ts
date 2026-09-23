import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { z } from "zod";
import type { AnalysisResult } from "../domain/models.js";
import { IdempotencyConflictError, IdempotencyInProgressError } from "../persistence/idempotency.js";
import type { AnalysisApiResponse, AnalysisReadResponse } from "../application/analysis-api-service.js";
import {
  AnalysisPlaceNotFoundError,
  AnalysisPlaceUnverifiedError,
  type SavedPlace,
} from "../application/saved-place-service.js";
import type { BrowserSessionService, ResolvedBrowserSession } from "../application/browser-session-service.js";

export const TIKTOK_ACCEPTANCE_URL = "https://vt.tiktok.com/ZSq4UprxR/";
const AnalysisIdSchema = z.string().uuid();

export interface SourceAnalyzer {
  execute(input: string): Promise<AnalysisResult>;
}

export interface AnalysisApi {
  analyze(userId: string, inputUrl: string, idempotencyKey: string): Promise<AnalysisApiResponse>;
  get(userId: string, analysisId: string): Promise<AnalysisReadResponse | undefined>;
}

export interface SavedPlacesApi {
  confirm(userId: string, analysisId: string, placeId: string): Promise<SavedPlace>;
  list(userId: string): Promise<SavedPlace[]>;
}

export type ProbeServerOptions = {
  analyzer: SourceAnalyzer;
  /** Omitted only when the deployment is misconfigured. */
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

/**
 * Shared product HTTP contract. Next route handlers and the legacy Node test
 * shell both delegate here, so the deployed WebApp cannot drift from smoke
 * coverage while the routes remain intentionally narrow.
 */
export function createProductRequestHandler(options: ProbeServerOptions): (request: Request) => Promise<Response> {
  const probeToken = options.probeToken?.trim() || undefined;
  const apiToken = options.apiToken?.trim() || undefined;

  return async (request) => {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse(200, {
          status: "ok",
          probeConfigured: probeToken !== undefined,
          analysisApiConfigured: Boolean(apiToken && options.analysisApi && options.savedPlacesApi && options.browserSessions),
        });
      }

      if (url.pathname === "/v1/analyses") {
        return handleAnalysisApi(request, options.analysisApi, options.browserSessions, apiToken);
      }

      const analysisMatch = /^\/v1\/analyses\/([^/]+)$/.exec(url.pathname);
      if (analysisMatch) {
        const analysisId = AnalysisIdSchema.safeParse(analysisMatch[1]);
        return analysisId.success
          ? handleAnalysisReadApi(request, options.analysisApi, options.browserSessions, apiToken, analysisId.data)
          : jsonResponse(404, { error: "not_found" });
      }

      if (url.pathname === "/v1/places") {
        return handleSavedPlacesApi(request, options.savedPlacesApi, options.browserSessions, apiToken);
      }

      const saveMatch = /^\/v1\/analyses\/([^/]+)\/places\/([^/]+)\/save$/.exec(url.pathname);
      if (saveMatch) {
        const analysisId = saveMatch[1];
        const placeId = saveMatch[2];
        return analysisId && placeId
          ? handleSavePlaceApi(request, options.savedPlacesApi, options.browserSessions, apiToken, analysisId, placeId)
          : jsonResponse(404, { error: "not_found" });
      }

      if (url.pathname !== "/internal/probes/tiktok") return jsonResponse(404, { error: "not_found" });
      if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "POST" });
      if (!probeToken) return jsonResponse(503, { error: "probe_unavailable" });
      if (!hasValidBearerToken(request, probeToken)) return jsonResponse(401, { error: "unauthorized" });

      try {
        return jsonResponse(200, toProbeResponse(await options.analyzer.execute(options.acceptanceUrl ?? TIKTOK_ACCEPTANCE_URL)));
      } catch {
        return jsonResponse(502, { error: "probe_failed" });
      }
    } catch {
      return jsonResponse(500, { error: "internal_error" });
    }
  };
}

/**
 * Retained as a test shell for the shared Web Request handler. Production is
 * served by Next App Router routes from M2.3 onward.
 */
export function createProbeServer(options: ProbeServerOptions): Server {
  const handle = createProductRequestHandler(options);
  return createServer((request, response) => {
    void handle(toWebRequest(request))
      .then((result) => writeWebResponse(response, result))
      .catch(() => writeWebResponse(response, jsonResponse(500, { error: "internal_error" })));
  });
}

async function handleAnalysisApi(request: Request, api: AnalysisApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "POST" });
  if (!api || !browserSessions || !apiToken) return jsonResponse(503, { error: "analysis_api_unavailable" });
  if (!hasValidBearerToken(request, apiToken)) return jsonResponse(401, { error: "unauthorized" });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey) return jsonResponse(400, { error: "idempotency_key_required" });
  const body = await readJson(request);
  if (!body || typeof body.url !== "string" || !body.url.trim()) return jsonResponse(400, { error: "invalid_request" });
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    const output = await api.analyze(session.userId, body.url, idempotencyKey);
    return jsonResponse(output.status, { ...output.body, replayed: output.replayed }, sessionHeaders(session));
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return jsonResponse(409, { error: "idempotency_conflict" }, sessionHeaders(session));
    if (error instanceof IdempotencyInProgressError) return jsonResponse(409, { error: "request_in_progress" }, sessionHeaders(session));
    return jsonResponse(502, { error: "analysis_failed" }, sessionHeaders(session));
  }
}

async function handleAnalysisReadApi(request: Request, api: AnalysisApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined, analysisId: string): Promise<Response> {
  if (request.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "GET" });
  if (!api || !browserSessions || !apiToken) return jsonResponse(503, { error: "analysis_api_unavailable" });
  if (!hasValidBearerToken(request, apiToken)) return jsonResponse(401, { error: "unauthorized" });
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    const output = await api.get(session.userId, analysisId);
    return output
      ? jsonResponse(output.status, output.body, sessionHeaders(session))
      : jsonResponse(404, { error: "analysis_not_found" }, sessionHeaders(session));
  } catch {
    return jsonResponse(502, { error: "analysis_read_failed" }, sessionHeaders(session));
  }
}

async function handleSavedPlacesApi(request: Request, api: SavedPlacesApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined): Promise<Response> {
  if (request.method !== "GET") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "GET" });
  if (!api || !browserSessions || !apiToken) return jsonResponse(503, { error: "analysis_api_unavailable" });
  if (!hasValidBearerToken(request, apiToken)) return jsonResponse(401, { error: "unauthorized" });
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    return jsonResponse(200, { places: await api.list(session.userId) }, sessionHeaders(session));
  } catch {
    return jsonResponse(502, { error: "saved_places_failed" }, sessionHeaders(session));
  }
}

async function handleSavePlaceApi(request: Request, api: SavedPlacesApi | undefined, browserSessions: BrowserSessionService | undefined, apiToken: string | undefined, analysisId: string, placeId: string): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" }, { allow: "POST" });
  if (!api || !browserSessions || !apiToken) return jsonResponse(503, { error: "analysis_api_unavailable" });
  if (!hasValidBearerToken(request, apiToken)) return jsonResponse(401, { error: "unauthorized" });
  const session = await resolveBrowserSession(request, browserSessions);
  try {
    return jsonResponse(200, { place: await api.confirm(session.userId, analysisId, placeId) }, sessionHeaders(session));
  } catch (error) {
    if (error instanceof AnalysisPlaceNotFoundError) return jsonResponse(404, { error: "analysis_place_not_found" }, sessionHeaders(session));
    if (error instanceof AnalysisPlaceUnverifiedError) return jsonResponse(422, { error: "place_not_verified" }, sessionHeaders(session));
    return jsonResponse(502, { error: "save_place_failed" }, sessionHeaders(session));
  }
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

function hasValidBearerToken(request: Request, expectedToken: string): boolean {
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(request.headers.get("authorization") ?? "");
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

async function resolveBrowserSession(request: Request, browserSessions: BrowserSessionService): Promise<ResolvedBrowserSession> {
  return browserSessions.resolve(request.headers.get("cookie") ?? undefined);
}

function sessionHeaders(session: ResolvedBrowserSession): Record<string, string> {
  return session.setCookie ? { "set-cookie": session.setCookie } : {};
}

async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  const body = request.body;
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function toWebRequest(request: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
    else if (value) headers.set(name, value.join(", "));
  }
  const init: RequestInit & { duplex?: "half" } = { method: request.method ?? "GET", headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`), init);
}

async function writeWebResponse(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string> = {};
  result.headers.forEach((value, name) => { headers[name] = value; });
  response.writeHead(result.status, headers);
  response.end(Buffer.from(await result.arrayBuffer()));
}
