<p align="center">
  <img src="docs/assets/saveplace-logo.svg" alt="SavePlace" width="420" />
</p>

# SavePlace

Turn a public social recommendation into a place worth saving — with evidence,
not geographic guesses.

SavePlace is an open-source TypeScript project that turns a public social URL
into provider-verified place data. It is both an AI-engineering portfolio case
study and the foundation of a product: every decision is designed to remain
useful when the first WebApp and contributors arrive.

> **Status — M2.8 pronto para validação remota.** TikTok acquisition,
> evidence-bound extraction, Google place verification, PostgreSQL persistence,
> cache, idempotency and explicit saved-place confirmation foram validados no
> Railway. O WebApp já suporta revisão, biblioteca privada e limite por sessão;
> o smoke completo de M2 deve passar após este deploy.

## The promise

```text
Public TikTok URL
  -> official URL metadata
  -> evidence-bound LLM candidates
  -> provider-verified places
  -> explicit save to a personal library
```

The LLM proposes candidates. It never verifies an address or coordinates.
Only a `PlaceProvider` can mark a place as verified. When evidence is missing
or ambiguous, SavePlace returns a clear review state instead of inventing a
location.

## What works today

- TikTok short URLs resolve through TikTok's official oEmbed metadata.
- Structured OpenAI extraction records its prompt version, latency, token use
  and estimated cost.
- Google Places verifies geographic identity; verified places are deduplicated
  by provider identity.
- PostgreSQL keeps the source-analysis cache reusable, while analysis history,
  idempotency state and the confirmed saved-place library remain private to an
  opaque browser session.
- Railway smoke checks exercise deployed acquisition plus the private analysis
  read, replay, cache, explicit save and library contracts.
- The Next.js App Router has a TikTok analysis review flow with explicit
  loading, insufficient-evidence and review states; it exposes no provider
  credentials or raw media.
- Provider-verified places are saved only after a click, then can be listed,
  marked visited or favorite, noted and removed from the private library.
- A browser session is limited to 10 uncached analyses per UTC calendar month
  by default. Cache hits and idempotency replays stay free; the limit is
  configurable only on the server.
- When `TYPESAFE_API_KEY` is configured, one batched Choice labels each
  candidate as supporting, ambiguous or unsupported evidence. It never
  verifies a place or saves one.
- Playwright covers the browser URL → review → explicit save → library journey
  with safe fake product responses; a separate opt-in command validates the
  equivalent temporary session flow on Railway.

Instagram is deliberately not part of the supported product path yet: its
official API requires a professional-account setup. The adapter fails safely
when those credentials are absent.

## Start here

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Run the local WebApp at `http://localhost:3000`:

```bash
npm run dev
```

With the server-side variables from the [operations guide](docs/PROJECT.md#operations), paste a public TikTok URL to review its evidence and verified places. Save a verified place only when you choose to; then manage it in the private library below the review. The browser never receives provider keys or `API_TOKEN`.

Analyze a public TikTok URL locally:

```bash
npm run analyze -- "https://vt.tiktok.com/..."
```

Use the deployment checks only from a trusted terminal with the required
environment variables:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-railway.ts
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-m1-railway.ts
# one-time local browser install: npx playwright install chromium
npm run test:e2e
# M2 remote validation after deploy (requires a known verified TikTok URL)
RUN_M2_RAILWAY_SMOKE=1 M2_SMOKE_TIKTOK_URL="https://vt.tiktok.com/..." \
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-m2-railway.ts
```

## Read more

| Looking for | Start here |
| --- | --- |
| Product story, architecture, API contract, provider boundaries and M2 direction | [Project guide](docs/PROJECT.md) |
| M2 WebApp scope and independently shippable PRs | [M2 plan](docs/M2.md) |
| M2 local and deployed release evidence | [M2 release verification](docs/M2-RELEASE.md) |
| M0 experiment, evidence-acquisition contract and evaluation rationale | [M0 spike](docs/M0.md) |
| Adding an evaluation URL | [Evaluation case guide](evals/cases/README.md) |
| Contributing safely | [Contributing](CONTRIBUTING.md) |
| Environment variables, Railway migration and operational checks | [Project guide: operations](docs/PROJECT.md#operations) |

## Contribute

SavePlace welcomes small, evidence-first improvements: source adapters that
fail safely, provider integrations, test fixtures, evaluation cases and
documentation. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a
pull request. The project is licensed under [MIT](LICENSE).
