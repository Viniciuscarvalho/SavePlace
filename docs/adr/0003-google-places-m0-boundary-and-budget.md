# ADR 0003 — Google Places M0 verification boundary and budget

- Status: Accepted
- Date: 2026-09-15

## Context

M0 needs a real external authority to verify a candidate's address and coordinates. The implementation must demonstrate precision and cost controls without making a third-party catalog a hidden dependency or violating its storage rules.

## Decision

Use Google Places API (New) Text Search behind `GooglePlacesProvider` for M0.4. Its request field mask is limited to:

```text
places.id, places.displayName, places.formattedAddress,
places.location, places.addressComponents
```

The provider returns a result only when Google supplies name, city, country and coordinates. It never promotes an LLM candidate to verified by itself. Invalid JSON, upstream failures, quota responses, missing location components and low-confidence name matches fail closed.

M0 applies a conservative default of 500 searches per UTC month per process, an in-memory guard deliberately below Google's stated free tier. The real provider project must also have a restricted API key, billing budget, quota and alerts. The M1 `UsageLedger` becomes the authoritative, transactional cross-replica cost limit.

Google response content is not persisted in M0. M1 may store the Google place ID, which Google documents as exempt from caching restrictions, but must not treat returned place content as a durable independent catalog. The M1 implementation must re-check the applicable terms and display/attribution requirements before storing or rendering other Google fields.

## Consequences

- M0.4 can produce provider-verified coordinates while retaining a replaceable `PlaceProvider` boundary.
- The M0 live contract is opt-in and has a bounded maximum cost.
- A later persistent catalog provider can replace Google without changing the domain model or extractor.
- The open-source core distributes adapters and fixtures, not provider keys or provider data.
