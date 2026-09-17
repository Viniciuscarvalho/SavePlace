<p align="center">
  <img src="docs/assets/saveplace-logo.svg" alt="SavePlace" width="420" />
</p>

# SavePlace

SavePlace is an open-source TypeScript spike for turning a public social URL
into conservative, provider-verified place data. It is an AI-engineering
portfolio project: reliability and evidence matter more than a polished UI.

> **Current stage: M1 persistence foundation.** The repository is still a
> modular TypeScript backend; it is not a WebApp or a public product API.

## What it proves

```text
Public TikTok URL
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
| Structured extraction | OpenAI Responses API with strict JSON Schema, evidence attribution, token/cost/latency trace. |
| Place verification | Google Places (New), minimal field mask, per-process M0 budget guard. |
| Evals | 10 TikTok cases, deterministic fixtures and an explicit paid live run. |
| Persistence / cache / saved list | PostgreSQL/Drizzle schema, migrations, source-analysis cache and idempotency repositories are ready; API and explicit save flows follow in M1.4. |
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

Analyze a TikTok URL. Without provider keys this still exercises acquisition
and returns no LLM or Google guesses.

```bash
npm run analyze -- "https://vt.tiktok.com/..."
```

## Configuration

Copy `.env.example` to an ignored `.env`; never commit provider keys or tokens.

| Variable | Used by | Required |
| --- | --- | --- |
| `OPENAI_API_KEY` | Structured extraction and live evaluation | Only for LLM runs |
| `DATABASE_URL` | M1 migrations and persistence-enabled deployments | Required only when running migrations/database-backed flows |
| `GOOGLE_MAPS_API_KEY` | Google Place verification | Only for resolution/live evaluation |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICE_PER_UNIT_USD` | Google Text Search unit price from the active billing contract | Optional; leave blank when unknown |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICING_SOURCE` | Where that Google price was verified | Optional but recommended with a price |
| `GOOGLE_PLACES_TEXT_SEARCH_PRICING_EFFECTIVE_DATE` | Date of the configured Google price | Optional but recommended with a price |
| `PROBE_TOKEN` | Railway diagnostic probe | Required only for the remote probe |
| `SAVEPLACE_PROBE_URL` | Railway smoke CLI | Required only for smoke testing |

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

## M1 persistence foundation

The foundation is deliberately limited to a reviewed Drizzle schema in
`src/persistence/schema.ts` and committed SQL under `drizzle/`. It includes
source aliases, analysis-cache keys, provider-owned place identities, explicit
user-place records, idempotency records and a usage ledger. The repository
boundary in `src/persistence/` can return a cached analysis before paid work
and can replay an idempotent response. It does **not** yet wire the CLI
pipeline to Postgres, expose a product API, or save a place automatically.

`sources` is unique by `(platform, canonical_url)` and aliases retain the
normalized submitted URL. The cache key is that alias plus `pipelineVersion`
and `providerConfigFingerprint`: a hit must not repeat acquisition, LLM or
Places work; a version or provider-configuration change deliberately causes a
miss. Invalid or unknown inputs are not cached. The M1.4 API will put the
idempotency claim around this cache: the key is scoped to a user and a stable
request hash, an identical retry replays the stored response, a reused key with
a different request is a conflict, and concurrent work is not repeated.
Failures retain only a generic response, never an exception message or secret.
No public endpoint or product TTL is exposed yet.

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

- `GET /health` is public and returns service health plus the safe boolean
  `probeConfigured`; it never returns the token.
- `POST /internal/probes/tiktok` accepts no arbitrary URL and requires a
  Bearer `PROBE_TOKEN`.

It is not the future product API. A `503 probe_unavailable` means the deployed
process cannot read its token; save the variable in the active service
environment and redeploy before rerunning the smoke command.

## Roadmap

1. **M1 API and saved list:** expose the persistence flows behind an API while
   preserving explicit confirmation before a place is saved.
2. **Optional Instagram adapter:** acquire only officially exposed evidence
   when provider access is available; no hidden scraping.
3. **M2 WebApp:** URL input, processing state and a personal verified-place
   library.
4. **Later:** iOS share flow.

## Contributing

Contributions are welcome once they preserve the evidence-first contract. Do
not commit credentials, downloaded media, private content, provider responses,
or generated evaluation results. Test cases must use public URLs and only the
minimum manually reviewed ground truth.

## License

No license has been selected yet. Add one before accepting broad external
contributions.
