# SavePlace — Agent Instructions

## Current milestone

M1 backend is complete and validated on Railway. M2 is the next milestone:
turn the persisted TikTok flow into a small WebApp while replacing the
single-owner deployment boundary with real user identity.

## Architecture rules

- Keep the core as a modular TypeScript monolith. M2 may add a WebApp, but do
  not split web, API and workers into separate services before product metrics
  justify it.
- A narrow authenticated HTTP probe may validate deployment egress, but it must not become a general source-ingestion API.
- Domain types must not depend on AI, social-network, or map-provider SDKs.
- Treat LLM output as candidate evidence, never geographic truth.
- Only a `PlaceProvider` can mark a resolved address as verified.
- Prefer progressive inference from evidence exposed legitimately by the source URL; richer provider-backed evidence may be added later.
- M0 is URL-only. Do not request local media or make upload a product fallback.
- Do not download/scrape protected social media as a hidden dependency. Adapters must explicitly return `insufficient_evidence` when content cannot be acquired legitimately/reliably.
- Support 0..N places per source.
- Use Zod at untrusted boundaries and structured outputs for AI integrations.
- Every AI call must be attributable to a model/prompt version and eventually expose token/cost/latency metrics.
- Never commit API keys, media files, transcripts containing sensitive data, or generated provider credentials.

## M2 starting boundary

- Preserve the M1 cache, idempotency and explicit confirmation contracts when
  introducing per-user identity.
- Keep TikTok as the supported source path. The optional Instagram adapter must
  continue to fail safely while its official professional-account integration
  is not configured.
- The WebApp may call a product API, but it must not receive provider secrets,
  raw protected media or an ability to choose another user's scope.

## Priority

1. Precision
2. Cost
3. Latency
4. Simplicity

## Completed M0 definition of done

Given a social URL, return a typed result containing source status, acquired evidence, extracted candidates, resolved places where possible, confidence, and a clear `insufficient_evidence` result when URL-only acquisition cannot proceed.
