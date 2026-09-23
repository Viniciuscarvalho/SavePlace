import { getApplicationRuntime } from "../../../../../../../application/application-runtime.js";
import { createBrowserProductRequestHandler } from "../../../../../../../http/browser-analysis.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ analysisId: string; placeId: string }> }): Promise<Response> {
  const { analysisId, placeId } = await context.params;
  return createBrowserProductRequestHandler(
    getApplicationRuntime(),
    `/v1/analyses/${encodeURIComponent(analysisId)}/places/${encodeURIComponent(placeId)}/save`,
  )(request);
}
