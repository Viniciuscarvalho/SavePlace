# M2 release verification

M2 is ready for release validation when the local browser journey and the
deployed session journey both pass. The two checks deliberately prove different
boundaries.

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

Record the command output and Railway deployment URL in the PR before calling
M2 complete. A local Playwright pass is not a claim of deployed-provider proof.
