import { describe, expect, it, vi } from "vitest";
import { InstagramSource } from "../src/ingestion/instagram-source.js";

const endpoint = "https://graph.facebook.com/v23.0/instagram_oembed";
const token = "test-access-token";

describe("InstagramSource", () => {
  it("turns official oEmbed metadata into evidence for a public Reel", async () => {
    const http = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        provider_name: "Instagram",
        title: "Café de bairro em Pinheiros",
        author_name: "Creator",
        thumbnail_url: "https://example.com/cover.jpg",
      }),
    });
    const result = await new InstagramSource({ http: http as unknown as typeof fetch, endpoint, accessToken: token })
      .acquire("https://instagram.com/reel/C0ffee_1/?utm_source=share");

    expect(http).toHaveBeenCalledTimes(1);
    const requested = new URL(String(http.mock.calls[0]?.[0]));
    expect(requested.origin + requested.pathname).toBe(endpoint);
    expect(requested.searchParams.get("url")).toBe("https://www.instagram.com/reel/C0ffee_1/");
    expect(requested.searchParams.get("access_token")).toBe(token);
    expect(http.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: "application/json" } });
    expect(result.status).toBe("acquired");
    if (result.status === "acquired") {
      expect(result.source).toMatchObject({
        canonicalUrl: "https://www.instagram.com/reel/C0ffee_1/",
        contentId: "C0ffee_1",
        platform: "instagram",
        description: "Café de bairro em Pinheiros",
      });
      expect(result.source.evidence.map((item) => item.type)).toEqual(["description", "author", "thumbnail"]);
      expect(JSON.stringify(result)).not.toContain(token);
    }
  });

  it("fails safely without configured credentials and makes no request", async () => {
    const http = vi.fn();
    const result = await new InstagramSource({ http: http as unknown as typeof fetch })
      .acquire("https://www.instagram.com/p/C0ffee_1/");

    expect(result).toMatchObject({ status: "insufficient_evidence", platform: "instagram" });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.instagram.com/p/C0ffee_1/",
    "https://instagram.com.example.com/p/C0ffee_1/",
    "https://www.instagram.com/explore/locations/123/",
  ])("rejects unsupported Instagram input without acquisition: %s", async (input) => {
    const http = vi.fn();
    const source = new InstagramSource({ http: http as unknown as typeof fetch, endpoint, accessToken: token });

    expect(source.canHandle(input)).toBe(false);
    await expect(source.acquire(input)).resolves.toMatchObject({ status: "unsupported" });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    ["non-official endpoint", "https://example.com/instagram_oembed"],
    ["unsupported Graph path", "https://graph.facebook.com/v23.0/anything"],
  ])("does not send the token to a %s", async (_label, invalidEndpoint) => {
    const http = vi.fn();
    const result = await new InstagramSource({
      http: http as unknown as typeof fetch,
      endpoint: invalidEndpoint,
      accessToken: token,
    }).acquire("https://www.instagram.com/p/C0ffee_1/");

    expect(result).toMatchObject({ status: "insufficient_evidence", platform: "instagram" });
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    ["bad provider", async () => ({ provider_name: "Other", title: "A place" })],
    ["no usable metadata", async () => ({ provider_name: "Instagram", author_name: "Creator" })],
    ["invalid JSON", async () => { throw new SyntaxError("invalid json"); }],
  ])("returns insufficient evidence for %s", async (_label, json) => {
    const http = vi.fn().mockResolvedValue({ ok: true, json });
    await expect(new InstagramSource({ http: http as unknown as typeof fetch, endpoint, accessToken: token })
      .acquire("https://www.instagram.com/p/C0ffee_1/"))
      .resolves.toMatchObject({ status: "insufficient_evidence", platform: "instagram" });
  });

  it("returns insufficient evidence when the provider request fails", async () => {
    const http = vi.fn().mockRejectedValue(new Error("network unavailable"));
    await expect(new InstagramSource({ http: http as unknown as typeof fetch, endpoint, accessToken: token })
      .acquire("https://www.instagram.com/p/C0ffee_1/"))
      .resolves.toMatchObject({ status: "insufficient_evidence", platform: "instagram" });
  });
});
