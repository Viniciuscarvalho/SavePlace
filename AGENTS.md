# SavePlace — Agent Instructions

## Current milestone

M0 — AI Spike. Validate video/social-source -> candidate extraction -> place resolution -> structured result before adding product infrastructure.

## Architecture rules

- Keep M0 as a modular TypeScript CLI, not a WebApp.
- Domain types must not depend on AI, social-network, or map-provider SDKs.
- Treat LLM output as candidate evidence, never geographic truth.
- Only a `PlaceProvider` can mark a resolved address as verified.
- Prefer progressive inference: metadata -> transcript -> frames -> multimodal.
- Do not download/scrape protected social media as a hidden dependency. Adapters must explicitly return `media_required` when content cannot be acquired legitimately/reliably.
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

Given a social URL or local media input, return a typed result containing source status, extracted candidates, resolved places where possible, confidence/evidence, and a clear fallback when media is required.
