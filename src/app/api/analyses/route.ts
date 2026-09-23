import { getApplicationRuntime } from "../../../application/application-runtime.js";
import { createBrowserAnalysisRequestHandler } from "../../../http/browser-analysis.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createBrowserAnalysisRequestHandler(getApplicationRuntime());

export const POST = handle;
