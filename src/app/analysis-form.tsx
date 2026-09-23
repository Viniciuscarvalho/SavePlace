"use client";

import { type FormEvent, useState } from "react";
import { z } from "zod";

const AnalysisViewSchema = z.object({
  status: z.enum(["completed", "insufficient_evidence", "needs_review", "failed"]),
  evidence: z.array(z.object({ type: z.string(), text: z.string() })),
  candidates: z.array(z.object({ rawName: z.string(), category: z.string(), cityHint: z.string().optional(), neighborhoodHint: z.string().optional() })),
  places: z.array(z.object({ name: z.string(), address: z.string(), city: z.string(), country: z.string(), provider: z.string(), providerPlaceId: z.string(), verified: z.literal(true) })),
  candidateEvidenceSupport: z.array(z.object({ candidateIndex: z.number().int().nonnegative(), status: z.enum(["supports", "ambiguous", "does_not_support", "unavailable"]), confidence: z.number().min(0).max(1).optional() })).optional(),
});
const AnalysisResponseSchema = z.object({ cache: z.enum(["hit", "miss", "skipped"]), result: AnalysisViewSchema });
const ErrorResponseSchema = z.object({ error: z.string() });
type AnalysisView = z.infer<typeof AnalysisViewSchema>;

const statusCopy: Record<AnalysisView["status"], { title: string; message: string }> = {
  completed: { title: "Places verified", message: "Only provider-verified places appear below." },
  needs_review: { title: "Review needed", message: "The public URL did not resolve every candidate with enough certainty." },
  insufficient_evidence: { title: "Not enough public evidence", message: "SavePlace did not infer a place from evidence that was not available." },
  failed: { title: "Analysis unavailable", message: "Try another public TikTok URL later." },
};

function supportCopy(status: NonNullable<AnalysisView["candidateEvidenceSupport"]>[number]["status"]): string {
  return ({ supports: "Evidence supports this candidate", ambiguous: "Evidence is ambiguous", does_not_support: "Evidence does not support this candidate", unavailable: "Evidence review unavailable" })[status];
}

export default function AnalysisForm() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AnalysisView>();
  const [cache, setCache] = useState<z.infer<typeof AnalysisResponseSchema>["cache"]>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(undefined);
    setResult(undefined);
    try {
      const response = await fetch("/api/analyses", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ url }),
      });
      const body: unknown = await response.json();
      const analysis = AnalysisResponseSchema.safeParse(body);
      if (analysis.success && (response.status === 200 || response.status === 422)) {
        setResult(analysis.data.result);
        setCache(analysis.data.cache);
        return;
      }
      const error = ErrorResponseSchema.safeParse(body);
      setMessage(error.success && error.data.error === "analysis_api_unavailable"
        ? "Analysis is not configured on this deployment yet."
        : "We could not analyze that URL. Try another public TikTok URL.");
    } catch {
      setMessage("We could not reach SavePlace. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <form className="analysis-form" onSubmit={submit}>
      <label htmlFor="source-url">Public TikTok URL</label>
      <div className="form-row">
        <input id="source-url" name="url" type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://vt.tiktok.com/..." autoComplete="url" />
        <button type="submit" disabled={loading}>{loading ? "Analyzing…" : "Analyze"}</button>
      </div>
      <p className="form-note">Analysis never saves a place. Saving remains an explicit next step.</p>
    </form>
    <p className="live-message" aria-live="polite">{loading ? "Looking at public URL evidence…" : message}</p>
    {result && <AnalysisResult result={result} cache={cache} />}
  </>;
}

function AnalysisResult({ result, cache }: { result: AnalysisView; cache: z.infer<typeof AnalysisResponseSchema>["cache"] | undefined }) {
  const copy = statusCopy[result.status];
  return <section className="analysis-result" aria-labelledby="analysis-title">
    <header className="result-heading">
      <div>
        <p className="eyebrow">Analysis {cache === "hit" ? "from cache" : "complete"}</p>
        <h2 id="analysis-title">{copy.title}</h2>
        <p>{copy.message}</p>
      </div>
      <span className={`status status-${result.status}`}>{result.status.replaceAll("_", " ")}</span>
    </header>

    <section className="result-section" aria-labelledby="verified-places-title">
      <h3 id="verified-places-title">Verified places</h3>
      {result.places.length > 0 ? <ul className="place-list">{result.places.map((place) => <li key={`${place.provider}:${place.providerPlaceId}`}>
        <strong>{place.name}</strong><span>{place.address}</span><span>{place.city}, {place.country}</span>
      </li>)}</ul> : <p>No verified place is available for this URL.</p>}
    </section>

    <section className="result-section" aria-labelledby="candidates-title">
      <h3 id="candidates-title">Candidates from the public evidence</h3>
      {result.candidates.length > 0 ? <ul className="candidate-list">{result.candidates.map((candidate, index) => {
        const support = result.candidateEvidenceSupport?.find((item) => item.candidateIndex === index);
        return <li key={`${candidate.rawName}-${index}`}>
          <strong>{candidate.rawName}</strong><span>{[candidate.category, candidate.neighborhoodHint, candidate.cityHint].filter(Boolean).join(" · ")}</span>
          {support && <span className={`support support-${support.status}`}>{supportCopy(support.status)}{support.confidence !== undefined ? ` (${Math.round(support.confidence * 100)}%)` : ""}</span>}
        </li>;
      })}</ul> : <p>No place candidate was extracted.</p>}
    </section>

    <section className="result-section" aria-labelledby="evidence-title">
      <h3 id="evidence-title">Public evidence used</h3>
      {result.evidence.length > 0 ? <ul className="evidence-list">{result.evidence.map((evidence, index) => <li key={`${evidence.type}-${index}`}><span>{evidence.type.replaceAll("_", " ")}</span>{evidence.text}</li>)}</ul> : <p>No reusable public evidence was returned.</p>}
    </section>
  </section>;
}
