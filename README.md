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

> **Status — M1 backend complete.** TikTok acquisition, evidence-bound
> extraction, Google place verification, PostgreSQL persistence, cache,
> idempotency and explicit saved-place confirmation have been validated on
> Railway. The WebApp is the next milestone.

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
- PostgreSQL persists analysis, candidates, cache/idempotency state and a
  confirmed single-owner saved-place library.
- Railway smoke checks exercise deployed acquisition and the complete M1
  persistence contract.

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

Analyze a public TikTok URL locally:

```bash
npm run analyze -- "https://vt.tiktok.com/..."
```

Use the deployment checks only from a trusted terminal with the required
environment variables:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-railway.ts
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-m1-railway.ts
```

## Read more

| Looking for | Start here |
| --- | --- |
| Product story, architecture, API contract, provider boundaries and M2 direction | [Project guide](docs/PROJECT.md) |
| M0 experiment, evidence-acquisition contract and evaluation rationale | [M0 spike](docs/M0.md) |
| Adding an evaluation URL | [Evaluation case guide](evals/cases/README.md) |
| Contributing safely | [Contributing](CONTRIBUTING.md) |
| Environment variables, Railway migration and operational checks | [Project guide: operations](docs/PROJECT.md#operations) |

## Contribute

SavePlace welcomes small, evidence-first improvements: source adapters that
fail safely, provider integrations, test fixtures, evaluation cases and
documentation. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a
pull request. The project is licensed under [MIT](LICENSE).
