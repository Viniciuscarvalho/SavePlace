import { randomUUID } from "node:crypto";
import { z } from "zod";

const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  analysisApiConfigured: z.boolean(),
});

const AnalysisResponseSchema = z.object({
  cache: z.enum(["hit", "miss"]),
  analysisId: z.string().uuid(),
  verifiedPlaceReferences: z.array(z.object({
    placeId: z.string().uuid(),
    provider: z.string().min(1),
    providerPlaceId: z.string().min(1),
  })),
  replayed: z.boolean(),
  result: z.object({
    source: z.object({ platform: z.literal("tiktok") }),
  }),
});

const AnalysisReadResponseSchema = AnalysisResponseSchema.omit({ cache: true, replayed: true });

const SavedPlaceResponseSchema = z.object({
  place: z.object({
    userPlaceId: z.string().uuid(),
    id: z.string().uuid(),
  }),
});

const SavedPlacesResponseSchema = z.object({
  places: z.array(z.object({
    userPlaceId: z.string().uuid(),
    id: z.string().uuid(),
  })),
});

const UpdatedSavedPlaceResponseSchema = z.object({
  place: z.object({
    userPlaceId: z.string().uuid(),
    id: z.string().uuid(),
    status: z.literal("visited"),
    favorite: z.literal(true),
    notes: z.literal("M2 release smoke"),
  }),
});

export const M1_SMOKE_TIKTOK_URL = "https://vt.tiktok.com/ZSq4UprxR/";

export type M1DeploymentCheckReport = {
  status: "ok";
  analysisId: string;
  firstCache: "hit" | "miss";
  cachedCache: "hit";
  verifiedPlaceCount: number;
  savedPlaceId: string;
  userPlaceId: string;
};

export type M2DeploymentCheckReport = M1DeploymentCheckReport & {
  libraryMutation: "updated_and_removed";
};

export class M1DeploymentCheckError extends Error {}

type DeploymentCheckOptions = {
  baseUrl: string;
  apiToken: string;
  sourceUrl?: string;
  fetchImpl?: typeof fetch;
  idempotencyKeyFactory?: () => string;
};

export async function runM1DeploymentCheck(options: DeploymentCheckOptions): Promise<M1DeploymentCheckReport> {
  return (await runBaseDeploymentCheck(options)).report;
}

/** Extends the M1 smoke with the private-library mutation and cleanup path. */
export async function runM2DeploymentCheck(options: DeploymentCheckOptions): Promise<M2DeploymentCheckReport> {
  const check = await runBaseDeploymentCheck(options);
  const updated = UpdatedSavedPlaceResponseSchema.parse(await requestJson(check.fetchImpl, new URL(`/v1/places/${encodeURIComponent(check.report.userPlaceId)}`, check.baseUrl), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${check.apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "visited", favorite: true, notes: "M2 release smoke" }),
  }, check.session));
  if (updated.place.userPlaceId !== check.report.userPlaceId || updated.place.id !== check.report.savedPlaceId) {
    throw new M1DeploymentCheckError("The saved-place update did not preserve the confirmed provider place.");
  }

  await requestJson(check.fetchImpl, new URL(`/v1/places/${encodeURIComponent(check.report.userPlaceId)}`, check.baseUrl), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${check.apiToken}` },
  }, check.session);
  const library = SavedPlacesResponseSchema.parse(await requestJson(check.fetchImpl, new URL("/v1/places", check.baseUrl), {
    headers: { Authorization: `Bearer ${check.apiToken}` },
  }, check.session));
  if (library.places.some((place) => place.userPlaceId === check.report.userPlaceId)) {
    throw new M1DeploymentCheckError("The M2 smoke saved place remained in the browser-session library after removal.");
  }

  return { ...check.report, libraryMutation: "updated_and_removed" };
}

async function runBaseDeploymentCheck(options: DeploymentCheckOptions): Promise<{
  report: M1DeploymentCheckReport;
  baseUrl: URL;
  apiToken: string;
  fetchImpl: typeof fetch;
  session: RequestSession;
}> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!options.apiToken.trim()) throw new M1DeploymentCheckError("API_TOKEN must be set.");
  const fetchImpl = options.fetchImpl ?? fetch;
  const session: RequestSession = {};
  const requestId = options.idempotencyKeyFactory?.() ?? randomUUID();
  const sourceUrl = options.sourceUrl ?? M1_SMOKE_TIKTOK_URL;

  const health = HealthResponseSchema.parse(await requestJson(fetchImpl, new URL("/health", baseUrl)));
  if (!health.analysisApiConfigured) {
    throw new M1DeploymentCheckError("Railway health is OK but the analysis API is unavailable. Set DATABASE_URL in the application service, apply migrations, then redeploy.");
  }

  const first = AnalysisResponseSchema.parse(await postAnalysis(fetchImpl, baseUrl, options.apiToken, sourceUrl, `m1-smoke-${requestId}`, session));
  if (first.replayed) throw new M1DeploymentCheckError("The first M1 smoke request unexpectedly replayed an idempotent response.");

  const replay = AnalysisResponseSchema.parse(await postAnalysis(fetchImpl, baseUrl, options.apiToken, sourceUrl, `m1-smoke-${requestId}`, session));
  if (!replay.replayed || replay.analysisId !== first.analysisId) {
    throw new M1DeploymentCheckError("The same idempotency key did not replay the original analysis response.");
  }

  const cached = AnalysisResponseSchema.parse(await postAnalysis(fetchImpl, baseUrl, options.apiToken, sourceUrl, `m1-smoke-cache-${requestId}`, session));
  if (cached.replayed || cached.cache !== "hit" || cached.analysisId !== first.analysisId) {
    throw new M1DeploymentCheckError("A new idempotency key did not return the cached analysis response.");
  }

  const readable = AnalysisReadResponseSchema.parse(await requestJson(fetchImpl, new URL(`/v1/analyses/${encodeURIComponent(first.analysisId)}`, baseUrl), {
    headers: { Authorization: `Bearer ${options.apiToken}` },
  }, session));
  if (readable.analysisId !== first.analysisId) {
    throw new M1DeploymentCheckError("The current browser session cannot read its linked analysis.");
  }

  const reference = first.verifiedPlaceReferences[0];
  if (!reference) {
    throw new M1DeploymentCheckError("The analysis has no provider-verified place to confirm. Configure the deployed OPENAI_API_KEY and GOOGLE_MAPS_API_KEY, then retry with a URL that resolves to a verified place.");
  }

  const saveUrl = new URL(`/v1/analyses/${encodeURIComponent(first.analysisId)}/places/${encodeURIComponent(reference.placeId)}/save`, baseUrl);
  const saved = SavedPlaceResponseSchema.parse(await requestJson(fetchImpl, saveUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiToken}` },
  }, session));
  if (saved.place.id !== reference.placeId) {
    throw new M1DeploymentCheckError("The saved-place response does not match the verified analysis place.");
  }

  const library = SavedPlacesResponseSchema.parse(await requestJson(fetchImpl, new URL("/v1/places", baseUrl), { headers: { Authorization: `Bearer ${options.apiToken}` } }, session));
  if (!library.places.some((place) => place.userPlaceId === saved.place.userPlaceId && place.id === reference.placeId)) {
    throw new M1DeploymentCheckError("The confirmed place was not present in the browser-session saved-place library.");
  }

  return {
    report: {
      status: "ok",
      analysisId: first.analysisId,
      firstCache: first.cache,
      cachedCache: cached.cache,
      verifiedPlaceCount: first.verifiedPlaceReferences.length,
      savedPlaceId: reference.placeId,
      userPlaceId: saved.place.userPlaceId,
    },
    baseUrl,
    apiToken: options.apiToken,
    fetchImpl,
    session,
  };
}

function normalizeBaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url;
  } catch {
    throw new M1DeploymentCheckError("SAVEPLACE_API_URL must be an HTTPS URL without credentials.");
  }
}

type RequestSession = { cookie?: string };

async function postAnalysis(fetchImpl: typeof fetch, baseUrl: URL, apiToken: string, sourceUrl: string, idempotencyKey: string, session: RequestSession): Promise<unknown> {
  return requestJson(fetchImpl, new URL("/v1/analyses", baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ url: sourceUrl }),
  }, session);
}

async function requestJson(fetchImpl: typeof fetch, url: URL, init: RequestInit = {}, session?: RequestSession): Promise<unknown> {
  let response: Response;
  try {
    const headers = new Headers(init.headers);
    if (session?.cookie) headers.set("Cookie", session.cookie);
    response = await fetchImpl(url, { ...init, headers });
  } catch {
    throw new M1DeploymentCheckError(`Unable to reach ${url.origin}.`);
  }
  const setCookie = response.headers.get("set-cookie");
  const cookie = setCookie?.split(";", 1)[0];
  if (session && cookie) session.cookie = cookie;
  const body: unknown = await response.json().catch(() => ({}));
  if (response.ok) return body;
  const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error
    : "unknown_error";
  if (response.status === 401) throw new M1DeploymentCheckError("Railway rejected API_TOKEN (HTTP 401). Confirm it matches the active SavePlace service variable.");
  if (response.status === 503) throw new M1DeploymentCheckError(`Railway analysis API is unavailable (HTTP 503: ${code}).`);
  throw new M1DeploymentCheckError(`Railway M1 request failed with HTTP ${response.status} (${code}).`);
}
