# M0.5 evaluation cases

Each JSON file names a public social URL and its manually reviewed expected
outcome. The case deliberately stores only the minimum ground truth needed to
score the pipeline; it never stores downloaded video, transcript, raw provider
response, API key, or private content.

Before a case can count toward the M0 gate, set `expected.manualStatus` to
`verified`, check the place name/city/category against the public source, and
record its stable `provider` and `providerPlaceId` after confirming the result
in the configured PlaceProvider project. Keep ambiguous links as `pending` so
they exercise acquisition and review handling without inflating quality.

When ground truth identifies a place but the correct M0 outcome is still
`needs_review`, set that place's `resolutionExpected` to `false`. It remains
visible as manual ground truth but is not counted as a failed verified-place
resolution target.

Run `npm run eval:m0` for deterministic fixture validation. Run the paid live
evaluation only with explicit environment configuration, and let its ignored
output in `evals/results/` be the report artifact. The M0 gate requires 10–15
public TikTok cases with manual ground truth; do not fill the corpus with
synthetic URLs or inferred provider IDs.
