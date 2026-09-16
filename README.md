<p align="center">
  <img src="docs/assets/saveplace-logo.svg" alt="SavePlace" width="420" />
</p>

# SavePlace

SavePlace is an open-source TypeScript spike for turning a public social URL
into conservative, provider-verified place data. It is an AI-engineering
portfolio project: reliability and evidence matter more than a polished UI.

> **Current stage: M0 validation.** This repository is a CLI plus a narrow
> Railway diagnostic probe. It is not a WebApp or a public product API.

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
| Evals | 10 TikTok cases, deterministic fixtures and an explicit paid live run. The quality gate is currently red. |
| Persistence / cache / saved list | M1, not implemented. |
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
| `GOOGLE_MAPS_API_KEY` | Google Place verification | Only for resolution/live evaluation |
| `GOOGLE_PLACES_TEXT_SEARCH_ESTIMATED_COST_USD` | Local evaluation cost estimate | Optional; leave blank when unknown |
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

For `.env` loading on Node 22, invoke an opt-in command explicitly:

```bash
RUN_M0_EVAL_LIVE=1 \
node --env-file=.env ./node_modules/tsx/dist/cli.mjs src/cli/eval-m0.ts --live --gate
```

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
failures.

## Deployment probe

Railway runs only a small HTTP process for M0.2 runtime validation:

- `GET /health` is public and returns service health.
- `POST /internal/probes/tiktok` accepts no arbitrary URL and requires a
  Bearer `PROBE_TOKEN`.

It is not the future product API. A `503 probe_unavailable` means the deployed
process cannot read its token; save the variable in the active service
environment and redeploy before rerunning the smoke command.

## Roadmap

1. **Finish M0:** improve candidate precision and multi-place extraction, make
   the Railway smoke green, and rerun the live quality gate.
2. **M1 processing engine:** PostgreSQL/Supabase persistence, source cache and
   idempotency, explicit save confirmation, jobs, shared usage ledger and
   tracing.
3. **M2 WebApp:** URL input, processing state and a personal verified-place
   library.
4. **Later:** Instagram adapter and iOS share flow.

## Contributing

Contributions are welcome once they preserve the evidence-first contract. Do
not commit credentials, downloaded media, private content, provider responses,
or generated evaluation results. Test cases must use public URLs and only the
minimum manually reviewed ground truth.

## License

No license has been selected yet. Add one before accepting broad external
contributions.
