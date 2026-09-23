import { getApplicationRuntime } from "../../../../application/application-runtime.js";
import { createBrowserProductRequestHandler } from "../../../../http/browser-analysis.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request, context: { params: Promise<{ userPlaceId: string }> }): Promise<Response> {
  const { userPlaceId } = await context.params;
  return createBrowserProductRequestHandler(getApplicationRuntime(), `/v1/places/${encodeURIComponent(userPlaceId)}`)(request);
}

export const PATCH = handle;
export const DELETE = handle;
