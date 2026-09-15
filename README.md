# SavePlace

Turn social videos into verified, structured places.

> SavePlace is a multimodal AI ingestion and entity-resolution system that transforms unstructured social video into verified, structured geographic data.

## Current stage: M0 — AI Spike

M0 validates the core pipeline before a WebApp, database, authentication, or iOS Share Extension.

```text
URL or local video
  -> source acquisition
  -> metadata/transcript evidence
  -> place extraction
  -> place resolution
  -> validated structured JSON
```

### Product principles

1. Precision over cost, latency, and simplicity.
2. The LLM extracts candidates; a place provider verifies addresses.
3. Never invent an address when resolution fails.
4. Progressive inference: metadata -> transcript -> selected frames -> multimodal reasoning.
5. Social URLs are not assumed to expose downloadable media. If evidence cannot be acquired, return `media_required` and request an upload.
6. Every result should be observable: method, confidence, latency, token usage, and cost.

## M0 CLI

```bash
npm install
cp .env.example .env
npm run analyze -- "https://www.youtube.com/shorts/19Ls-ZMU86c"
```

The first YouTube Short is intentionally kept as an eval case. Acquisition restrictions are part of the product problem: the adapter must degrade to `media_required` rather than depend on scraping/downloading video.

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
