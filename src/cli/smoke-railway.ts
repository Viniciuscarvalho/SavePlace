import { hasExpectedTikTokEvidence, RailwayProbeResponseSchema } from "../application/railway-probe-contract.js";

const baseUrl = process.env.SAVEPLACE_PROBE_URL?.trim();
const probeToken = process.env.PROBE_TOKEN?.trim();
if (!baseUrl || !probeToken) {
  throw new Error("SAVEPLACE_PROBE_URL and PROBE_TOKEN must be set.");
}

const endpoint = new URL("/internal/probes/tiktok", baseUrl);
const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${probeToken}` } });
if (!response.ok) {
  const body = await response.json().catch(() => ({}));
  if (response.status === 503) {
    throw new Error("Railway probe is unavailable: the deployed process has no non-empty PROBE_TOKEN. In Railway, open the SavePlace service in the active environment, set PROBE_TOKEN to the exact non-empty secret, save, then redeploy.");
  }
  if (response.status === 401) {
    throw new Error("Railway probe rejected the token (HTTP 401). Confirm the local PROBE_TOKEN exactly matches the active Railway service variable, without extra whitespace, then rerun after deployment.");
  }
  if (response.status === 502) {
    throw new Error("Railway probe reached the service but TikTok acquisition failed upstream (HTTP 502). Inspect deployment logs; the token itself was accepted.");
  }
  const error = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : "unknown_error";
  throw new Error(`Railway probe returned HTTP ${response.status} (${error}).`);
}

const result = RailwayProbeResponseSchema.parse(await response.json());
if (!hasExpectedTikTokEvidence(result)) {
  throw new Error("Railway probe did not acquire the expected TikTok URL evidence.");
}

console.log(JSON.stringify(result, null, 2));
