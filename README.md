# SavePlace

Turn social videos into verified, structured places.

> SavePlace is a multimodal AI ingestion and entity-resolution system that transforms unstructured social video into verified, structured geographic data.

## Current stage: M0 — AI Spike

M0 validates the core pipeline before a WebApp, database, authentication, or iOS Share Extension.

```text
Social URL
  -> source acquisition
  -> provider-backed URL evidence
  -> place extraction
  -> place resolution
  -> validated structured JSON
```

### Product principles

1. Precision over cost, latency, and simplicity.
2. The LLM extracts candidates; a place provider verifies addresses.
3. Never invent an address when resolution fails.
4. Acquire the cheapest legitimate URL evidence first; richer provider-backed evidence can be added only when justified.
5. M0 is URL-only. It never downloads protected media or asks the user to upload it; unavailable evidence returns `insufficient_evidence`.
6. Every result should be observable: method, confidence, latency, token usage, and cost.

## M0 CLI

```bash
npm install
cp .env.example .env
npm run analyze -- "https://vt.tiktok.com/ZSq4UprxR/"
```

The TikTok adapter sends the original short URL directly to TikTok's official oEmbed endpoint. TikTok resolves it server-side and returns attributable metadata plus canonical post identity; SavePlace does not preflight or download the media URL.

Run the live provider contract test explicitly in the target runtime:

```bash
npm run test:integration:tiktok
```

The live test is excluded from the default deterministic suite because network access and third-party content can change.

## Railway deployment probe

M0 remains a CLI. The small HTTP process exists only to prove that the target runtime can acquire the acceptance TikTok URL; it is not a public ingestion API or a WebApp.

`railway.toml` uses Railpack, compiles TypeScript to `dist/`, starts `node dist/server.js`, and configures `GET /health` as the deployment healthcheck. No Dockerfile is required.

Before deploying the draft PR, add a non-empty `PROBE_TOKEN` as a Railway service variable. Railway provides `PORT`; do not set it yourself.

After generating a Railway public domain, run the authenticated smoke test from a trusted terminal:

```bash
SAVEPLACE_PROBE_URL="https://your-service.up.railway.app" \
PROBE_TOKEN="your-secret" \
npm run test:railway:smoke
```

The smoke test calls `POST /internal/probes/tiktok` with a bearer token. The endpoint only evaluates the fixed M0 acceptance URL and returns allowlisted status, canonical identity, evidence types and counts. It never accepts a supplied URL or returns caption, author, thumbnail, prompt data or tokens.

## M0 success criteria

- Produce `PlaceCandidate[]` from available textual evidence.
- Resolve candidates through a replaceable `PlaceProvider`.
- Persist no unverified address as verified truth.
- Support multiple places per source.
- Emit structured confidence and processing metadata.
- Build a golden dataset starting with 10–15 real videos.

## Not in M0

WebApp, database, authentication, Share Extension/App Clip, production queue, recommendation engine, and embedded maps are intentionally deferred.

See `docs/M0.md` for the spike plan and `AGENTS.md` for implementation constraints.
