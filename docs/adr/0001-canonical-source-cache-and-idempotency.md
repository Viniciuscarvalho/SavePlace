# ADR 0001 — Canonical source cache and idempotent analysis

- Status: Accepted
- Date: 2026-09-15

## Context

Re-submitting a TikTok URL must not repeat acquisition, LLM extraction, or place resolution and incur another cost. A short URL and a canonical TikTok URL can refer to the same post, while an unfamiliar short URL cannot be canonicalized without one legitimate oEmbed request.

## Decision

M1 treats a `Source` as the canonical, provider-owned identity of social content.

1. Normalize the submitted URL for an exact alias lookup first.
2. If an alias or canonical URL is known, return the latest completed analysis for the current pipeline version. Do not invoke TikTok, the LLM, or the place provider.
3. Otherwise acquire URL evidence once, upsert `Source(platform, canonical_url)`, and record the submitted normalized URL as a `SourceAlias`.
4. For a concurrent first submission, a database uniqueness constraint and transaction/row lock elect one analysis run; followers return its queued or completed result instead of starting another run.
5. A user-visible `Reanalyze` action is the only normal cache bypass. It creates an immutable new `AnalysisRun` with a new generation and never overwrites the prior trace.

The cache key is the canonical source identity plus a versioned pipeline fingerprint. That fingerprint includes acquisition adapter version, extractor model and prompt version, resolver/provider version, and schema version. An automatic request never refreshes a completed run merely because external content might have changed; that is an explicit product action.

## Consequences

- Repeated submissions are cheap and predictable.
- A new, unknown short alias may make one oEmbed call before it joins an existing canonical source, but it must not repeat LLM or place work.
- Results are reproducible because a completed run preserves its fingerprint, evidence hash, timings, token usage and estimated cost.
- Provider changes intentionally invalidate the analysis cache through a new fingerprint rather than silently changing old results.
