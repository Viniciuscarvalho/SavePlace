"use client";

import { type FormEvent, useEffect, useState } from "react";
import { z } from "zod";

const AnalysisViewSchema = z.object({
  status: z.enum(["completed", "insufficient_evidence", "needs_review", "failed"]),
  evidence: z.array(z.object({ type: z.string(), text: z.string() })),
  candidates: z.array(z.object({ rawName: z.string(), category: z.string(), cityHint: z.string().optional(), neighborhoodHint: z.string().optional() })),
  places: z.array(z.object({ name: z.string(), address: z.string(), city: z.string(), country: z.string(), provider: z.string(), providerPlaceId: z.string(), verified: z.literal(true) })),
  candidateEvidenceSupport: z.array(z.object({ candidateIndex: z.number().int().nonnegative(), status: z.enum(["supports", "ambiguous", "does_not_support", "unavailable"]), confidence: z.number().min(0).max(1).optional() })).optional(),
});
const AnalysisResponseSchema = z.object({
  cache: z.enum(["hit", "miss", "skipped"]),
  analysisId: z.string().uuid().optional(),
  verifiedPlaceReferences: z.array(z.object({ placeId: z.string().uuid(), provider: z.string(), providerPlaceId: z.string() })).optional(),
  result: AnalysisViewSchema,
});
const ErrorResponseSchema = z.object({ error: z.string() });
const SavedPlaceSchema = z.object({
  userPlaceId: z.string().uuid(), id: z.string().uuid(), name: z.string(), address: z.string(), city: z.string(), country: z.string(), provider: z.string(), providerPlaceId: z.string(),
  status: z.enum(["want_to_go", "visited"]), favorite: z.boolean(), notes: z.string().optional(),
});
const SavedPlacesResponseSchema = z.object({ places: z.array(SavedPlaceSchema) });
const SavedPlaceResponseSchema = z.object({ place: SavedPlaceSchema });
type AnalysisView = z.infer<typeof AnalysisViewSchema>;
type SavedPlace = z.infer<typeof SavedPlaceSchema>;

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
  const [analysisId, setAnalysisId] = useState<string>();
  const [verifiedPlaceReferences, setVerifiedPlaceReferences] = useState<z.infer<typeof AnalysisResponseSchema>["verifiedPlaceReferences"]>();
  const [cache, setCache] = useState<z.infer<typeof AnalysisResponseSchema>["cache"]>();
  const [message, setMessage] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [libraryMessage, setLibraryMessage] = useState<string>();
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [savingPlaceId, setSavingPlaceId] = useState<string>();
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  async function loadLibrary() {
    setLibraryLoading(true);
    try {
      const response = await fetch("/api/places", { credentials: "same-origin" });
      const parsed = SavedPlacesResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      setSavedPlaces(parsed.data.places);
      setLibraryMessage(undefined);
    } catch {
      setLibraryMessage("Your saved places are unavailable right now.");
    } finally {
      setLibraryLoading(false);
    }
  }

  useEffect(() => { void loadLibrary(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(undefined);
    setResult(undefined);
    setAnalysisId(undefined);
    setVerifiedPlaceReferences(undefined);
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
        setAnalysisId(analysis.data.analysisId);
        setVerifiedPlaceReferences(analysis.data.verifiedPlaceReferences);
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
    {result && <AnalysisResult result={result} cache={cache} analysisId={analysisId} verifiedPlaceReferences={verifiedPlaceReferences} savedPlaces={savedPlaces} savingPlaceId={savingPlaceId} onSave={async (placeId) => {
      if (!analysisId) return;
      setSavingPlaceId(placeId);
      try {
        const response = await fetch(`/api/analyses/${encodeURIComponent(analysisId)}/places/${encodeURIComponent(placeId)}/save`, { method: "POST", credentials: "same-origin" });
        const parsed = SavedPlaceResponseSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        setSavedPlaces((places) => [...places.filter((place) => place.userPlaceId !== parsed.data.place.userPlaceId), parsed.data.place]);
        setLibraryMessage("Place saved to your library.");
      } catch {
        setLibraryMessage("We could not save that place. Try again.");
      } finally {
        setSavingPlaceId(undefined);
      }
    }} />}
    <SavedPlaceLibrary places={savedPlaces} loading={libraryLoading} message={libraryMessage} noteDrafts={noteDrafts} onNoteDraft={setNoteDrafts} onUpdate={async (userPlaceId, update) => {
      try {
        const response = await fetch(`/api/places/${encodeURIComponent(userPlaceId)}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(update) });
        const parsed = SavedPlaceResponseSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        setSavedPlaces((places) => places.map((place) => place.userPlaceId === userPlaceId ? parsed.data.place : place));
        setLibraryMessage("Library updated.");
      } catch {
        setLibraryMessage("We could not update that saved place. Try again.");
      }
    }} onRemove={async (userPlaceId) => {
      try {
        const response = await fetch(`/api/places/${encodeURIComponent(userPlaceId)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) throw new Error();
        setSavedPlaces((places) => places.filter((place) => place.userPlaceId !== userPlaceId));
        setLibraryMessage("Place removed from your library.");
      } catch {
        setLibraryMessage("We could not remove that saved place. Try again.");
      }
    }} />
  </>;
}

function AnalysisResult({ result, cache, analysisId, verifiedPlaceReferences, savedPlaces, savingPlaceId, onSave }: {
  result: AnalysisView;
  cache: z.infer<typeof AnalysisResponseSchema>["cache"] | undefined;
  analysisId: string | undefined;
  verifiedPlaceReferences: z.infer<typeof AnalysisResponseSchema>["verifiedPlaceReferences"];
  savedPlaces: SavedPlace[];
  savingPlaceId: string | undefined;
  onSave: (placeId: string) => Promise<void>;
}) {
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
      {result.places.length > 0 ? <ul className="place-list">{result.places.map((place) => {
        const placeId = verifiedPlaceReferences?.find((reference) => reference.provider === place.provider && reference.providerPlaceId === place.providerPlaceId)?.placeId;
        const saved = placeId ? savedPlaces.some((savedPlace) => savedPlace.id === placeId) : false;
        return <li key={`${place.provider}:${place.providerPlaceId}`}>
          <strong>{place.name}</strong><span>{place.address}</span><span>{place.city}, {place.country}</span>
          {analysisId && placeId && <button type="button" onClick={() => void onSave(placeId)} disabled={savingPlaceId === placeId || saved}>
            {saved ? "Saved" : savingPlaceId === placeId ? "Saving…" : "Save place"}
          </button>}
        </li>;
      })}</ul> : <p>No verified place is available for this URL.</p>}
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

function SavedPlaceLibrary({ places, loading, message, noteDrafts, onNoteDraft, onUpdate, onRemove }: {
  places: SavedPlace[];
  loading: boolean;
  message: string | undefined;
  noteDrafts: Record<string, string>;
  onNoteDraft: (drafts: Record<string, string>) => void;
  onUpdate: (userPlaceId: string, update: { status?: "want_to_go" | "visited"; favorite?: boolean; notes?: string | null }) => Promise<void>;
  onRemove: (userPlaceId: string) => Promise<void>;
}) {
  return <section className="analysis-result library" aria-labelledby="library-title">
    <header className="result-heading"><div><p className="eyebrow">Your library</p><h2 id="library-title">Saved places</h2><p>Only places you explicitly save appear here.</p></div></header>
    <p className="live-message" aria-live="polite">{message}</p>
    {loading ? <p>Loading your saved places…</p> : places.length === 0 ? <p>No saved places yet.</p> : <ul className="place-list">{places.map((place) => <li key={place.userPlaceId}>
      <strong>{place.name}</strong><span>{place.address}</span><span>{place.city}, {place.country}</span>
      <label>Status<select value={place.status} onChange={(event) => void onUpdate(place.userPlaceId, { status: event.target.value as "want_to_go" | "visited" })}><option value="want_to_go">Want to go</option><option value="visited">Visited</option></select></label>
      <button type="button" onClick={() => void onUpdate(place.userPlaceId, { favorite: !place.favorite })}>{place.favorite ? "Remove favorite" : "Favorite"}</button>
      <label>Note<input value={noteDrafts[place.userPlaceId] ?? place.notes ?? ""} maxLength={2000} onChange={(event) => onNoteDraft({ ...noteDrafts, [place.userPlaceId]: event.target.value })} /></label>
      <button type="button" onClick={() => void onUpdate(place.userPlaceId, { notes: (noteDrafts[place.userPlaceId] ?? place.notes ?? "").trim() || null })}>Save note</button>
      <button className="danger" type="button" onClick={() => void onRemove(place.userPlaceId)}>Remove</button>
    </li>)}</ul>}
  </section>;
}
