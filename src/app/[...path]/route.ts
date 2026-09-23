import { getApplicationRuntime } from "../../application/application-runtime.js";
import { createProductRequestHandler } from "../../http/probe-server.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createProductRequestHandler(getApplicationRuntime());

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
