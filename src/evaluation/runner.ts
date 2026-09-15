import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AnalysisResult } from "../domain/models.js";
import { EvaluationCaseSchema, EvaluationFixtureSchema, type EvaluationCase, type EvaluationObservation } from "./contracts.js";
import { calculateEvaluationReport, type EvaluationReport } from "./metrics.js";

export type EvaluateInput = (input: string) => Promise<AnalysisResult>;

export async function loadEvaluationCases(casesDirectory: string): Promise<EvaluationCase[]> {
  const names = (await readdir(casesDirectory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => EvaluationCaseSchema.parse(JSON.parse(await readFile(path.join(casesDirectory, name), "utf8")))));
}

export async function runFixtureEvaluation(cases: EvaluationCase[], fixturesDirectory: string): Promise<EvaluationReport> {
  const observations: EvaluationObservation[] = await Promise.all(cases.map(async (evaluationCase) => {
    const fixturePath = path.join(fixturesDirectory, evaluationCase.fixture);
    const fixture = EvaluationFixtureSchema.parse(JSON.parse(await readFile(fixturePath, "utf8")));
    return { evaluationCase, ...fixture };
  }));
  return calculateEvaluationReport("fixture", observations);
}

function acquisitionFor(result: AnalysisResult): "acquired" | "insufficient_evidence" | "unsupported" {
  if (result.status === "insufficient_evidence") return "insufficient_evidence";
  if (result.status === "failed" && result.evidence.length === 0) return "unsupported";
  return "acquired";
}

export async function runLiveEvaluation(cases: EvaluationCase[], evaluateInput: EvaluateInput): Promise<EvaluationReport> {
  const liveCases = cases.filter((evaluationCase) => evaluationCase.live);
  const observations: EvaluationObservation[] = await Promise.all(liveCases.map(async (evaluationCase) => {
    const result = await evaluateInput(evaluationCase.input);
    return { evaluationCase, acquisition: acquisitionFor(result), analysis: result };
  }));
  return calculateEvaluationReport("live", observations);
}
