# SavePlace — Agent Instructions

## Current milestone

M0 — AI Spike. Validate social URL -> evidence acquisition -> candidate extraction -> place resolution -> structured result before adding product infrastructure.

## Architecture rules

- Keep M0 as a modular TypeScript CLI, not a WebApp.
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

## Priority

1. Precision
2. Cost
3. Latency
4. Simplicity

## M0 definition of done

Given a social URL, return a typed result containing source status, acquired evidence, extracted candidates, resolved places where possible, confidence, and a clear `insufficient_evidence` result when URL-only acquisition cannot proceed.
