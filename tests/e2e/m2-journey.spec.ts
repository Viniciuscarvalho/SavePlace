import { expect, test, type Route } from "@playwright/test";

const analysisId = "00000000-0000-4000-8000-000000000101";
const placeId = "00000000-0000-4000-8000-000000000102";
const userPlaceId = "00000000-0000-4000-8000-000000000103";

type SupportStatus = "supports" | "ambiguous" | "unavailable";
type SavedPlace = {
  userPlaceId: string;
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  provider: string;
  providerPlaceId: string;
  status: "want_to_go" | "visited";
  favorite: boolean;
  notes?: string;
};

function resultFor(status: SupportStatus) {
  const verified = status === "supports";
  return {
    cache: "miss",
    analysisId,
    verifiedPlaceReferences: verified ? [{ placeId, provider: "google_places", providerPlaceId: "e2e-coffee" }] : [],
    result: {
      status: verified ? "completed" : "needs_review",
      evidence: [{ type: "source_url", text: "Public TikTok URL supplied by the visitor." }],
      candidates: [{ rawName: "E2E Coffee", category: "cafe", cityHint: "São Paulo" }],
      places: verified ? [{ name: "E2E Coffee", address: "Rua de Teste, 1", city: "São Paulo", country: "BR", provider: "google_places", providerPlaceId: "e2e-coffee", verified: true }] : [],
      candidateEvidenceSupport: [{ candidateIndex: 0, status, ...(status === "ambiguous" ? { confidence: 0.51 } : status === "supports" ? { confidence: 0.97 } : {}) }],
    },
  };
}

function savedPlace(): SavedPlace {
  return {
    userPlaceId,
    id: placeId,
    name: "E2E Coffee",
    address: "Rua de Teste, 1",
    city: "São Paulo",
    country: "BR",
    provider: "google_places",
    providerPlaceId: "e2e-coffee",
    status: "want_to_go",
    favorite: false,
  };
}

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }) => {
  let library: SavedPlace[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/places" && request.method() === "GET") return json(route, { places: library });
    if (pathname === "/api/analyses" && request.method() === "POST") {
      const sourceUrl = JSON.parse(request.postData() ?? "{}") as { url?: string };
      const status: SupportStatus = sourceUrl.url?.includes("ambiguous") ? "ambiguous" : sourceUrl.url?.includes("unavailable") ? "unavailable" : "supports";
      return json(route, resultFor(status));
    }
    if (pathname === `/api/analyses/${analysisId}/places/${placeId}/save` && request.method() === "POST") {
      const place = savedPlace();
      library = [place];
      return json(route, { place });
    }
    return json(route, { error: "not_found" }, 404);
  });
});

test("visitor reviews a verified place and explicitly saves it to the private library", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("No saved places yet.")).toBeVisible();

  await page.getByLabel("Public TikTok URL").fill("https://vt.tiktok.com/e2e-supports");
  await page.getByRole("button", { name: "Analyze" }).click();
  await expect(page.getByRole("heading", { name: "Places verified" })).toBeVisible();
  await expect(page.getByText("Evidence supports this candidate (97%)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save place" })).toBeVisible();

  await page.getByRole("button", { name: "Save place" }).click();
  await expect(page.getByText("Place saved to your library.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved places" })).toBeVisible();
  await expect(page.getByText("E2E Coffee", { exact: true }).last()).toBeVisible();
});

for (const scenario of [
  { url: "https://vt.tiktok.com/e2e-unavailable", copy: "Evidence review unavailable" },
  { url: "https://vt.tiktok.com/e2e-ambiguous", copy: "Evidence is ambiguous (51%)" },
]) {
  test(`shows the TypeSafe ${scenario.copy.toLowerCase()} review state`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Public TikTok URL").fill(scenario.url);
    await page.getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("heading", { name: "Review needed" })).toBeVisible();
    await expect(page.getByText(scenario.copy)).toBeVisible();
    await expect(page.getByText("No verified place is available for this URL.")).toBeVisible();
  });
}
