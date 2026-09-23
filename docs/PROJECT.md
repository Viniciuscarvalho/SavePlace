# SavePlace project guide

This guide is the detailed technical and portfolio record. The
[README](../README.md) stays deliberately short so a newcomer can understand
the project and run it without first reading its entire history.

## Problem and product hypothesis

People discover restaurants, cafés and other places in social posts, but a URL
alone is not a dependable place record. SavePlace tests whether a conservative
pipeline can turn legitimate evidence exposed by a public URL into a verified
place that a person explicitly chooses to save.

The product does not scrape protected media, download videos, accept uploads as
a hidden fallback, or treat an LLM's answer as geographic truth. When the URL
cannot supply enough legitimate evidence, the result is
`insufficient_evidence` or `needs_review`.

## Architecture

SavePlace is a modular TypeScript monolith. It keeps product rules independent
from social, AI and map SDKs so each provider can change without changing the
domain contract.

```text
social URL
  -> ContentSource (TikTok official oEmbed)
  -> Evidence[]
  -> PlaceExtractor (OpenAI structured output)
  -> optional CandidateEvidenceJudge (TypeSafe support signal)
  -> PlaceProvider (Google Places)
  -> AnalysisResult
  -> PostgreSQL cache / idempotency / verified place links
  -> explicit UserPlace confirmation
```

The Railway service currently hosts one Next.js process: the App Router serves
the WebApp shell and the existing health, probe and product endpoints as route
handlers. PostgreSQL runs as a separate Railway service. OpenAI, Google Places
and social providers remain external dependencies. This is intentionally
inexpensive and simple while the product learns whether the workflow is useful.
The optional judgment runs once for all candidates and is review context only:
it cannot change the PlaceProvider path or geographic verification.

## Non-negotiable data rules

- LLM output is candidate evidence, never an address, coordinate or verified
  place.
- Only `PlaceProvider` output may set `verified: true`.
- A source may yield zero, one or many candidates and places.
- A confirmed saved item must link to a provider-verified place from the exact
  persisted analysis; arbitrary provider IDs are rejected.
- A repeated URL can return cache data. An identical idempotency key replays
  the original safe response, avoiding another paid pipeline execution.
- Credentials, protected media, raw provider payloads and generated live-eval
  results are never committed.

## Milestones

### M0 — evidence and quality spike — complete

M0 validated the hard technical uncertainty before product infrastructure:

- TikTok short URLs acquire official oEmbed metadata in the Railway runtime.
- OpenAI produces schema-constrained candidates with evidence attribution,
  model/prompt version, latency, token use and cost fields.
- Google Places is the only verifier and exposes a provider place identity.
- The evaluation harness uses public URL cases, deterministic fixtures and an
  opt-in live quality gate with cost and latency reporting.

The narrow `POST /internal/probes/tiktok` endpoint exists only to prove
deployment egress with a fixed URL. It is authenticated and cannot become a
general-purpose fetching API.

### M1 — persisted backend — complete

M1 added the smallest durable product boundary:

- Drizzle schema and reviewed SQL migrations for sources, aliases, analyses,
  candidate mentions, provider places, idempotency state, user places and a
  provider-usage ledger.
- Cached, authenticated `POST /v1/analyses` for TikTok URLs.
- Explicit `POST /v1/analyses/:analysisId/places/:placeId/save`; analysis alone
  never creates a library record.
- Authenticated `GET /v1/places` for the configured owner.
- Railway pre-deploy migration and a remote M1 smoke contract that proves
  analysis, same-key replay, URL cache, save and list.

M1 intentionally has a static deployment token and a single configured owner.
It is an implementation boundary, not end-user authentication.

### M2.1 — private browser sessions

M2.1 replaces the static owner boundary with an opaque browser session. The
server creates a random token, stores only its SHA-256 hash in PostgreSQL and
returns it in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. A request derives
its user on the server; it never accepts a user ID, bearer token or provider
credential from the browser. The URL-analysis cache remains global, while
idempotency operations and saved places are private to that session.

`API_TOKEN` remains a temporary operational gate for the direct HTTP API until
M2.7 supplies per-user cost limits. It is never sent to a browser; the future
WebApp will call the application server with its already-resolved session.

### M2.2 — private analysis history

`user_analyses` links a session-owned user to a globally cached
`source_analyses` record. A successful analysis links its result before the
idempotency response is stored; a valid legacy replay response establishes the
same link without running the paid pipeline again. `GET /v1/analyses/:analysisId`
returns a result only through that user link, and a guessed ID returns absence.
The explicit save path applies the same ownership check before it can create a
library item.

### M2.3 — Next.js product shell

The Railway process now starts Next.js. A small server-rendered entry page has
no analysis controls, provider credentials or protected media. One dynamic App
Router handler delegates `/health`, `/internal/probes/tiktok` and `/v1/*` to
the existing HTTP contract, while the retained Node adapter exercises that
same contract in deterministic tests. The build still emits `dist/cli/migrate.js`
before `next build`, so Railway's existing pre-deploy migration remains intact.

## HTTP contract

`GET /health` is public and returns only health plus safe configuration
booleans. Product endpoints derive their scope from a server-managed browser
session cookie.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/analyses` | Analyze a TikTok URL. Requires `Idempotency-Key`; a new key may return a URL cache hit. |
| `GET /v1/analyses/:analysisId` | Read an analysis only when it is linked to the current browser session. |
| `POST /v1/analyses/:analysisId/places/:placeId/save` | Explicitly save a provider-verified place linked to that analysis. |
| `GET /v1/places` | Read the current browser session's saved library. |
| `POST /internal/probes/tiktok` | Fixed-URL operational probe; requires `PROBE_TOKEN`, accepts no user URL. |

The direct API remains intentionally narrow until the WebApp supplies the
user-facing interaction model and M2.7 adds per-user cost limits.

## Operations

Copy `.env.example` to an ignored `.env`; no real key belongs in Git.

| Variable | Role |
| --- | --- |
| `OPENAI_API_KEY` | Optional structured extraction. |
| `TYPESAFE_API_KEY` | Optional candidate-evidence support; unavailable without it and never used for verification or saving. |
| `GOOGLE_MAPS_API_KEY` | Optional Google place verification. |
| `DATABASE_URL` | PostgreSQL connection for persistence. On Railway, reference the Postgres service variable. |
| `API_TOKEN` | Temporary server-side gate for direct product API calls until M2.7. |
| `PROBE_TOKEN` | Authenticates the fixed Railway probe. |
| `SAVEPLACE_PROBE_URL`, `SAVEPLACE_API_URL` | Trusted-terminal targets for probe and persisted-session smoke checks. |
| `INSTAGRAM_OEMBED_ACCESS_TOKEN`, `INSTAGRAM_OEMBED_ENDPOINT`, `INSTAGRAM_OEMBED_TEST_URL` | Optional official Instagram oEmbed integration and its opt-in contract test. |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD`, `GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE`, `GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE` | Optional price from the active Google billing contract. Leave blank when unknown. |

The M2.4 adapter pins `jev-1.13.0`; its estimated cost uses TypeSafe's
published US$0.042 per one million input tokens for that model (checked
2026-09-23). Returned model, token use and latency stay attached to the
analysis.

Railway runs this before starting the service:

```bash
npm run db:migrate:production
```

Use a Railway Postgres variable reference for `DATABASE_URL`; never copy a
connection URL into version control. The migration command is safe to rerun,
but production recovery remains an intentional operational action.

### Validation commands

```bash
npm run typecheck
npm test

# fixed URL: deployed TikTok evidence acquisition
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-railway.ts

# deployed analysis, private read, replay, cache, explicit save and library read
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/smoke-m1-railway.ts
```

Live evaluation is opt-in because it can call paid providers:

```bash
RUN_M0_EVAL_LIVE=1 \
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/eval-m0.ts --live --gate
```

The evaluation output is ignored by Git. Costs stay `null` when the current
Google contract price is not configured; SavePlace never invents a price.

### Command reference

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Validate TypeScript. |
| `npm test` | Run deterministic tests; live provider integrations stay skipped. |
| `npm run dev` | Run the local Next.js WebApp. |
| `npm run build` | Compile production migrations and build the Next.js Railway service. |
| `npm run analyze -- <url>` | Run the local URL pipeline. |
| `npm run test:integration:tiktok` | Opt-in TikTok provider contract test. |
| `npm run test:integration:instagram` | Opt-in official Instagram oEmbed contract test. |
| `npm run test:integration:google-places` | Opt-in Google Places contract test. |
| `npm run test:railway:smoke` | Run the authenticated fixed-URL Railway probe when its variables are already exported. |
| `npm run test:railway:m1` | Run the complete remote M1 contract check when its variables are already exported. |
| `npm run eval:m0` | Run deterministic M0 evaluation fixtures. |
| `npm run eval:m0:live` / `npm run eval:m0:gate` | Run paid live evaluation or enforce its quality gate. |
| `npm run db:generate` | Generate a reviewed Drizzle migration. |
| `npm run db:migrate` / `npm run db:migrate:production` | Apply committed migrations when `DATABASE_URL` is intentionally injected. |

## M2 direction

M2 turns the validated backend into a useful product without splitting the
system prematurely. Keep a single Railway project and evolve only when metrics
justify more infrastructure:

```text
M1: Railway -> Node API + PostgreSQL
M2: Railway -> Web/API + PostgreSQL
Later: Web + API + worker + PostgreSQL + queue + observability
```

The M2 sequence, identity decision, optional TypeSafe evidence signal and
independently shippable PRs are defined in the [M2 plan](M2.md). It keeps the
existing place-verification rule intact while adding a browser-owned user scope
and a small WebApp before introducing workers or queues.

M2.4 is implemented as one optional, batched TypeSafe Choice request per
analysis. It records the returned model, prompt version, latency, tokens and
estimated input cost; a low-confidence result is exposed as `ambiguous`.
Neither a negative signal nor an unavailable provider changes a Google-verified
place, authorization or explicit-save contract.

## Portfolio evidence and limitations

This repository demonstrates an AI system that can be inspected rather than
merely demoed: source evidence is explicit, model output is typed, geographic
truth has a separate provider, provider calls are attributable and paid runs
are opt-in. The local test suite and Railway smoke checks are engineering
evidence, not a claim of production-scale accuracy, adoption or cost.
