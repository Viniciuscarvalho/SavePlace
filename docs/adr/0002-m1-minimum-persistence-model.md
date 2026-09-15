# ADR 0002 — M1 minimum persistence model

- Status: Accepted
- Date: 2026-09-15

## Context

M0 proves acquisition, extraction and resolution without a database. M1 needs a persistent user list, deterministic retries and cost attribution, but does not need a full product platform or external queue on day one.

## Decision

M1 begins as one TypeScript service and one Postgres database. A durable database-backed job table replaces an external queue until measured throughput requires one.

The minimum model is:

| Entity | Purpose | Identity rule |
| --- | --- | --- |
| `Source` | Canonical social content identity | unique `(platform, canonical_url)` |
| `SourceAlias` | Normalized URL a user submitted | unique `normalized_input_url` -> `Source` |
| `AnalysisRun` | Immutable acquisition/extraction/resolution trace | unique active idempotency key; explicit generation for reanalysis |
| `Candidate` | LLM-produced candidate and bounded evidence reference | scoped to `AnalysisRun` |
| `Place` | Provider-backed place identity | unique `(provider, provider_place_id)` |
| `PlaceMention` | Verified relation between a source/run candidate and a place | unique `(analysis_run_id, candidate_id, place_id)` |
| `UserPlace` | A user's explicitly saved list item | unique `(user_id, place_id)` |
| `UsageLedger` | Atomic provider and model usage accounting | unique `(provider, period)` with transactional increments |

Submitting a URL persists or reuses `Source` and an `AnalysisRun`. It does **not** create `UserPlace`. The UI/API exposes candidates and verified places for confirmation; only an explicit Save creates a personal list record. Removing an item changes `UserPlace`, never the shared source, run, or place evidence.

`AnalysisRun` records provider/model/prompt versions, evidence hash, status, attempts, latency, tokens and cost. The durable job table owns `queued`, `processing`, `completed`, `needs_review` and `failed` transitions, retry count and lease expiry. No raw provider payload or credentials are persisted.

## Consequences

- The saved list respects user intent while analysis remains cacheable across repeat submissions.
- There is a small, reviewable path from URL to saved place suitable for a portfolio and open-source core.
- Postgres provides idempotency and budget accounting before Redis, a workflow engine, authentication providers or microservices are introduced.
- Multi-user readiness is present in `UserPlace` without claiming multi-user product functionality in M1.
