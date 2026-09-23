import { getApplicationRuntime } from "../../../application/application-runtime.js";
import { createBrowserProductRequestHandler } from "../../../http/browser-analysis.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createBrowserProductRequestHandler(getApplicationRuntime(), "/v1/places");

export const GET = handle;
