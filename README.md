<p align="center">
  <img src="docs/assets/saveplace-logo.svg" alt="SavePlace" width="420" />
</p>

# SavePlace

SavePlace is an open-source TypeScript spike for turning a public social URL
into conservative, provider-verified place data. It is an AI-engineering
portfolio project: reliability and evidence matter more than a polished UI.

> **Current stage: M1.4c saved-place library API.** The repository is
> still a modular TypeScript backend; it is not a WebApp or a public product
> API.

## What it proves

```text
Public TikTok or Instagram URL
  -> official oEmbed metadata
  -> evidence-bound LLM candidates
  -> external PlaceProvider verification
  -> typed result or needs_review
```

- The LLM can suggest candidates, but never verifies addresses or coordinates.
- A `PlaceProvider` is the only component allowed to return `verified: true`.
- Generic cities and neighborhoods are location hints, not resolvable venues.
- Unsupported or insufficient sources fail safely; SavePlace never downloads
  protected social media as a hidden dependency.

## Current capability and limits

| Area | State |
| --- | --- |
| TikTok URL acquisition | Official oEmbed adapter; live runtime probe still needs a healthy token configuration. |
| Instagram URL acquisition | Official, credentialed Meta oEmbed adapter for posts, Reels and TV posts; missing configuration fails safely without a request. |
| Structured extraction | OpenAI Responses API with strict JSON Schema, evidence attribution, token/cost/latency trace. |
| Place verification | Google Places (New), minimal field mask, per-process M0 budget guard. |
| Evals | 10 TikTok cases, deterministic fixtures and an explicit paid live run. |
| Persistence / cache / saved list | Cache, idempotency, analyses, candidates and provider-verified place links persist transactionally; the single-owner API requires explicit confirmation before a saved library record exists. |
| WebApp | M2, not implemented. |

Fixtures validate the runner contract and regressions; the live run measures
current provider and model quality. Neither is a production-quality claim.
Run the commands below to generate the local report.

## Quick start

```bash
npm install
cp .env.example .env
npm run typecheck
npm test
```

Analyze a TikTok URL. An Instagram URL additionally requires the official Meta
oEmbed variables below. Without LLM/Google keys, acquisition still runs but
returns no LLM or Google guesses.

```bash
npm run analyze -- "https://vt.tiktok.com/..."
```

For Instagram, replace the endpoint's `vXX.X` placeholder with a supported
Graph API version, then load the local environment explicitly on Node 22:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/analyze.ts \
  "https://www.instagram.com/reel/.../"
```

## Configuration

Copy `.env.example` to an ignored `.env`; never commit provider keys or tokens.

| Variable | Used by | Required |
| --- | --- | --- |
| `OPENAI_API_KEY` | Structured extraction and live evaluation | Only for LLM runs |
| `INSTAGRAM_OEMBED_ACCESS_TOKEN` | Official Meta oEmbed request | With endpoint, only for Instagram URLs |
| `INSTAGRAM_OEMBED_ENDPOINT` | Official HTTPS Graph API `instagram_oembed` endpoint; replace `vXX.X` in the example with a supported version | With access token, only for Instagram URLs |
| `INSTAGRAM_OEMBED_TEST_URL` | Opt-in live Instagram oEmbed contract test | Only for that test |
| `DATABASE_URL` | M1 migrations and persistence-enabled deployments | Required only when running migrations/database-backed flows |
| `GOOGLE_MAPS_API_KEY` | Google Place verification | Only for resolution/live evaluation |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD` | Google Text Search unit price from the active billing contract | Optional; leave blank when unknown |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE` | Where that Google price was verified | Optional but recommended with a price |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE` | Date of the configured Google price | Optional but recommended with a price |
| `PROBE_TOKEN` | Railway diagnostic probe | Required only for the remote probe |
| `SAVEPLACE_PROBE_URL` | Railway smoke CLI | Required only for smoke testing |
| `API_TOKEN` | Authenticates the M1.4 analysis API | With `DATABASE_URL` and `SAVEPLACE_OWNER_ID`, only for the API |
| `SAVEPLACE_OWNER_ID` | Server-owned single-owner scope for analysis idempotency | With `DATABASE_URL` and `API_TOKEN`, only for the API |

`PROBE_TOKEN` must be a non-empty service variable in the same Railway
deployment environment as the running container. A local `.env` does not
configure Railway.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript validation |
| `npm test` | Deterministic unit tests; provider integrations stay skipped |
| `npm run build` | Compile the Railway process |
| `npm run analyze -- <url>` | Run the local pipeline |
| `npm run test:integration:tiktok` | Opt-in live TikTok contract test |
| `npm run test:integration:instagram` | Opt-in live Instagram oEmbed contract test |
| `npm run test:integration:google-places` | Opt-in Google contract test |
| `npm run test:railway:smoke` | Authenticated fixed-URL Railway egress probe |
| `npm run eval:m0` | Deterministic M0.5 fixtures; writes ignored local output |
| `npm run eval:m0:live` | Paid live evaluation; requires exported provider keys |
| `npm run eval:m0:gate` | Live quality gate; exits non-zero until all criteria pass |
| `npm run db:generate` | Generate a reviewed Drizzle SQL migration from the schema |
| `npm run db:migrate` | Apply committed migrations when `DATABASE_URL` is already injected |
| `npm run db:migrate:production` | Apply committed migrations from the compiled runtime image |

For `.env` loading on Node 22, invoke an opt-in command explicitly:

```bash
RUN_M0_EVAL_LIVE=1 \
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/eval-m0.ts --live --gate
```

## M1.4a analysis persistence

The foundation is deliberately limited to a reviewed Drizzle schema in
`src/persistence/schema.ts` and committed SQL under `drizzle/`. It includes
source aliases, analysis-cache keys, provider-owned place identities, explicit
user-place records, idempotency records and a usage ledger. The repository
boundary in `src/persistence/` can return a cached analysis before paid work
and can replay an idempotent response. M1.4a itself did not wire the CLI
pipeline to Postgres, expose an API, or save a place automatically; the narrow
M1.4b/c API below now wires only the authenticated server flow.

`sources` is unique by `(platform, canonical_url)` and aliases retain the
normalized submitted URL. The cache key is that alias plus `pipelineVersion`
and `providerConfigFingerprint`: a hit must not repeat acquisition, LLM or
Places work; a version or provider-configuration change deliberately causes a
miss. Invalid or unknown inputs are not cached. The M1.4 API will put the
idempotency claim around this cache: the key is scoped to a user and a stable
request hash, an identical retry replays the stored response, a reused key with
a different request is a conflict, and concurrent work is not repeated.
Failures retain only a generic response, never an exception message or secret.
The M1.4b endpoint now exposes this contract; product-facing authentication,
multiple users and TTL policy remain later work.

When a pipeline result is passed to `DrizzlePersistenceRepository.storeAnalysis`,
each `placeMention` retains its candidate and evidence and receives a `placeId`
only when the exact link has `ResolvedPlace.verified === true`. The repository
deduplicates provider places by `(provider, providerPlaceId)` and replaces
mentions atomically when a cached analysis is refreshed. Legacy results without
that explicit link retain unresolved candidates rather than guessing a
relationship. The API persists cacheable analysis results through this
repository; the CLI does not. Analysis still never creates a `UserPlace`
automatically: only the explicit M1.4c confirmation below can do so.

Generate migrations locally and review their SQL before committing:

```bash
npm run db:generate -- --name descriptive_change
```

Apply committed migrations only against the intended development/staging
database. A copied `.env` is not loaded by `npm run db:migrate`, so use Node
22's explicit loading locally:

```bash
node --env-file=.env --import tsx src/cli/migrate.ts
```

For Railway, provision Postgres, inject its `DATABASE_URL` reference into the
**SavePlace application service**, build the app, then run
`npm run db:migrate:production` in a trusted release/job context. Migrations
do not run on application startup.

## M1.4b cached analysis API

The optional `POST /v1/analyses` endpoint connects TikTok acquisition, the
evidence-first pipeline, persistence, cache and idempotency. It is enabled only
when the application service has `DATABASE_URL`, `API_TOKEN` and
`SAVEPLACE_OWNER_ID`. The owner scope is deployment configuration; clients
cannot submit or select a user ID.

```bash
curl -X POST https://your-service.up.railway.app/v1/analyses \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Idempotency-Key: a-new-unique-key" \
  -H "Content-Type: application/json" \
  --data '{"url":"https://vt.tiktok.com/.../"}'
```

An identical retry with the same key returns the retained safe response with
`replayed: true`. The same URL under a new key returns `cache: "hit"` without
repeating source acquisition, LLM extraction or place resolution. Reusing a
key for a different payload returns `409 idempotency_conflict`; a concurrent
request returns `409 request_in_progress`. Inputs that cannot establish a
cacheable source return `422` and do not create a cache entry. When the
endpoint is not configured it returns `503 analysis_api_unavailable` while
`GET /health` remains healthy and reports `analysisApiConfigured: false`.

Every cacheable response also includes `verifiedPlaceReferences`: internal
`placeId` values paired with provider identity for the verified places linked
to that exact `analysisId`. They are the only IDs accepted by the save endpoint
below; a provider place ID or arbitrary UUID is not sufficient.

## M1.4c explicit saved-place library

Analysis alone never creates a library item. After reviewing an analysis, a
client must explicitly confirm one of its `verifiedPlaceReferences`:

```bash
curl -X POST \
  "https://your-service.up.railway.app/v1/analyses/$ANALYSIS_ID/places/$PLACE_ID/save" \
  -H "Authorization: Bearer $API_TOKEN"

curl https://your-service.up.railway.app/v1/places \
  -H "Authorization: Bearer $API_TOKEN"
```

The service proves the submitted place belongs to that analysis through the
persisted mention and a provider-verified place row before it upserts the
server-owned user's `UserPlace`. It returns `404 analysis_place_not_found` for
a mismatched analysis/place pair or a place without a verified reference, and
`422 place_not_verified` when a repository can identify an associated but
unverified mention. Repeating confirmation is safe and returns the same library
item; `GET /v1/places` lists only this configured owner's places.

## Evaluation and safety gates

Cases live under `evals/cases/`; deterministic responses live in
`evals/fixtures/`; timestamps and local cost reports are ignored under
`evals/results/`. See [the case guide](evals/cases/README.md) before adding a
URL.

The M0 gate requires:

- at least 10 public TikTok URLs with manual expected results;
- known provider/place IDs where a place is expected;
- an explicit local estimate for each paid PlaceProvider request;
- at least 90% candidate precision and 95% provider-ID resolution accuracy;
- a healthy Railway smoke probe for the acceptance URL, validated separately
  from `eval:m0:gate`.

The corpus intentionally includes unavailable, ambiguous and multi-place posts.
They prevent a “happy-path only” score from hiding acquisition or extraction
failures. Each report includes a per-case failure class (for example
`ACQUISITION_FAILURE`, `EXTRACTION_FALSE_POSITIVE`, `RESOLUTION_FAILURE` or
`PROVIDER_FAILURE`) plus explicit metric denominators. If Google pricing is not
configured, all total and per-place costs are `null` with
`pricing_not_configured`—never `$0`.

Resolver ranking is deterministic: exact/contained name identity is the base
signal; literal city, neighborhood and country matches add confidence, while
missing locality hints reduce it. Results below the conservative threshold stay
in `needs_review`; an LLM never supplies an address.

## Deployment probe

Railway runs only a small HTTP process for M0.2 runtime validation:

- `GET /health` is public and returns service health plus the safe booleans
  `probeConfigured` and `analysisApiConfigured`; it never returns a token.
- `POST /internal/probes/tiktok` accepts no arbitrary URL and requires a
  Bearer `PROBE_TOKEN`.

It is not the future product API. A `503 probe_unavailable` means the deployed
process cannot read its token; save the variable in the active service
environment and redeploy before rerunning the smoke command.

## Roadmap

1. **M1.5 deployment validation:** apply migrations to Railway Postgres and
   run the cache/idempotency contract against that environment.
2. **M2 WebApp:** URL input, processing state and a personal verified-place
   library.
3. **Later:** iOS share flow.

## Contributing

Contributions are welcome once they preserve the evidence-first contract. Do
not commit credentials, downloaded media, private content, provider responses,
or generated evaluation results. Test cases must use public URLs and only the
minimum manually reviewed ground truth.

## License

No license has been selected yet. Add one before accepting broad external
contributions.
