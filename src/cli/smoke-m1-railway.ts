import { runM1DeploymentCheck } from "../application/m1-deployment-check.js";

const baseUrl = process.env.SAVEPLACE_API_URL?.trim();
const apiToken = process.env.API_TOKEN?.trim();
if (!baseUrl || !apiToken) {
  throw new Error("SAVEPLACE_API_URL and API_TOKEN must be set.");
}

const result = await runM1DeploymentCheck({
  baseUrl,
  apiToken,
  ...(process.env.M1_SMOKE_TIKTOK_URL?.trim() ? { sourceUrl: process.env.M1_SMOKE_TIKTOK_URL.trim() } : {}),
});
console.log(JSON.stringify(result, null, 2));
