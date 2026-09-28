# M2 release verification

M2 passed release validation when the local browser journey and the deployed
session journey both passed. The two checks deliberately prove different
boundaries and remain the revalidation procedure for a future deployment.

## Local browser journey

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright runs the real Next.js UI and intercepts only its same-origin product
routes. The fixtures cover a verified candidate with TypeSafe `supports`, an
`ambiguous` low-confidence signal, and `unavailable`. No TikTok, OpenAI,
TypeSafe or Google request is made by this test.

It proves that a visitor can submit a URL, review safe output and explicitly
save a verified place to the rendered library. It does not prove a provider or
Railway integration.

## Deployed session journey

After Railway deploys the branch and applies migrations, set a public TikTok
URL that has already resolved to at least one provider-verified place:

```bash
RUN_M2_RAILWAY_SMOKE=1 \
M2_SMOKE_TIKTOK_URL="https://vt.tiktok.com/..." \
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-m2-railway.ts
```

The check starts a fresh browser session, proves idempotency replay and cache
reuse, reads the linked analysis, explicitly saves the verified place, updates
it, removes it and confirms the library is empty. It may call configured
providers when the chosen URL misses the cache, so it is intentionally opt-in.

Record the command output and Railway deployment URL for a future deploy. A
local Playwright pass alone is not a claim of deployed-provider proof.

## Recorded validation

The remote smoke passed after the M2 deployment. It created a fresh session,
returned one provider-verified place, replayed idempotency, hit cache with a
new key, then saved, updated and removed the temporary library item. The
M2.7 aggregate metrics endpoint was also available. This is deployment-contract
evidence, not a claim of product adoption or production-scale performance.
