import { createProductRequestHandler, type ProbeServerOptions } from "./probe-server.js";

/** Gives WebApp routes a same-origin product entry point without exposing API_TOKEN. */
export function createBrowserProductRequestHandler(options: ProbeServerOptions, productPath: string): (request: Request) => Promise<Response> {
  const productHandler = createProductRequestHandler(options);

  return (request) => {
    const headers = new Headers(request.headers);
    const apiToken = options.apiToken?.trim();
    if (apiToken) headers.set("authorization", `Bearer ${apiToken}`);
    const init: RequestInit & { duplex?: "half" } = { method: request.method, headers, body: request.body };
    if (request.body) init.duplex = "half";
    return productHandler(new Request(new URL(productPath, request.url), init));
  };
}
