import AnalysisForm from "./analysis-form.js";

export default function HomePage() {
  return <main>
    <section className="hero" aria-labelledby="page-title">
      <p className="eyebrow">SavePlace</p>
      <h1 id="page-title">Save the place, not the guess.</h1>
      <p className="lede">Paste a public TikTok recommendation. SavePlace shows the evidence, candidate places and locations verified by a place provider.</p>
      <AnalysisForm />
    </section>
  </main>;
}
