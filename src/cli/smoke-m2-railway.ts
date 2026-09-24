import { runM2DeploymentCheck } from "../application/m1-deployment-check.js";

if (process.env.RUN_M2_RAILWAY_SMOKE !== "1") {
  throw new Error("Set RUN_M2_RAILWAY_SMOKE=1 to run the deployed M2 smoke. It can call configured providers on a cache miss.");
}

const baseUrl = process.env.SAVEPLACE_API_URL?.trim();
const apiToken = process.env.API_TOKEN?.trim();
const sourceUrl = process.env.M2_SMOKE_TIKTOK_URL?.trim();
if (!baseUrl || !apiToken || !sourceUrl) {
  throw new Error("SAVEPLACE_API_URL, API_TOKEN and M2_SMOKE_TIKTOK_URL must be set.");
}

console.log(JSON.stringify(await runM2DeploymentCheck({ baseUrl, apiToken, sourceUrl }), null, 2));
