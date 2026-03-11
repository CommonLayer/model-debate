import type { DebateExport, DebateSettings, DebateTurn, DebateRunResult } from "@/lib/types";

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function renderTranscriptMarkdown(turns: DebateTurn[]): string {
  return turns
    .map((turn) => {
      return [
        `### Round ${turn.round} - Participant ${turn.participant}`,
        "",
        `- Model: ${turn.model}`,
        "",
        turn.text
      ].join("\n");
    })
    .join("\n\n");
}

export function buildDebateExport(input: {
  settings: DebateSettings;
  result: DebateRunResult;
}): DebateExport {
  return {
    version: 1,
    generatedAt: input.result.meta.generatedAt,
    settings: input.settings,
    result: input.result
  };
}

export function buildDebateMarkdown(exportPayload: DebateExport): string {
  return [
    "# Model Debate",
    "",
    `- Generated at: ${exportPayload.generatedAt}`,
    `- Topic: ${exportPayload.settings.topic}`,
    `- Objective: ${exportPayload.settings.objective}`,
    `- Participant A model: ${exportPayload.result.meta.effectiveModels.participantA}`,
    `- Participant B model: ${exportPayload.result.meta.effectiveModels.participantB}`,
    `- Synthesis model: ${exportPayload.result.meta.effectiveModels.synthesis}`,
    "",
    "## Synthesis",
    "",
    exportPayload.result.synthesis.markdown,
    "",
    "## Transcript",
    "",
    renderTranscriptMarkdown(exportPayload.result.transcript)
  ].join("\n");
}

export function getExportBaseFilename(topic: string, generatedAt: string): string {
  const compactTimestamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const slug = slugify(topic) || "model-debate";

  return `${compactTimestamp}-${slug}`;
}

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
