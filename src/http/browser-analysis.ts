import { createProductRequestHandler, type ProbeServerOptions } from "./probe-server.js";

/** Gives the WebApp a same-origin analysis entry point without exposing API_TOKEN. */
export function createBrowserAnalysisRequestHandler(options: ProbeServerOptions): (request: Request) => Promise<Response> {
  const productHandler = createProductRequestHandler(options);

  return (request) => {
    const headers = new Headers(request.headers);
    const apiToken = options.apiToken?.trim();
    if (apiToken) headers.set("authorization", `Bearer ${apiToken}`);
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, body: request.body };
    if (request.body) init.duplex = "half";
    return productHandler(new Request(new URL("/v1/analyses", request.url), init));
  };
}
