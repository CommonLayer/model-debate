import type {
  DebateExport,
  DebateLanguage,
  DebateSynthesisFormat,
  DebateSettings,
  DebateRunResult,
  ResolvedExcerpt,
  SourceFileRef,
  SourcePack
} from "@/lib/types";
import { detectDebateLanguage } from "@/lib/prompts";

function getSynthesisFormatLabel(
  format: DebateSynthesisFormat,
  language: DebateLanguage
): string {
  if (language === "fr") {
    if (format === "tech_architecture") {
      return "Technique / Architecture";
    }

    if (format === "decision_strategy") {
      return "Decision / Strategie";
    }

    if (format === "factual_practical") {
      return "Factuel / Pratique";
    }

    if (format === "proof_validation") {
      return "Preuve / Validation";
    }

    return "Auto";
  }

  if (format === "tech_architecture") {
    return "Tech / Architecture";
  }

  if (format === "decision_strategy") {
    return "Decision / Strategy";
  }

  if (format === "factual_practical") {
    return "Factual / Practical";
  }

  if (format === "proof_validation") {
    return "Proof / Validation";
  }

  return "Auto";
}

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildDebateExport(input: {
  settings: DebateSettings;
  result: DebateRunResult;
  sourcePack?: SourcePack | null;
}): DebateExport {
  return {
    version: 1,
    generatedAt: input.result.meta.generatedAt,
    settings: input.settings,
    sourcePack: input.sourcePack || null,
    result: input.result
  };
}

function renderSourceFilesMarkdown(files: SourceFileRef[], language: DebateLanguage): string {
  if (files.length === 0) {
    return language === "fr" ? "_Aucun document prepare._" : "_No prepared documents._";
  }

  return files
    .map((file) => {
      const location =
        file.origin === "github"
          ? `${file.repoUrl || "GitHub"} @ ${file.ref || "default"} · ${file.path || file.label}`
          : file.path || file.label;

      return `- ${file.origin}: ${location}`;
    })
    .join("\n");
}

function renderExcerptMarkdown(excerpts: ResolvedExcerpt[], language: DebateLanguage): string {
  if (excerpts.length === 0) {
    return language === "fr" ? "_Aucun passage prepare._" : "_No prepared passages._";
  }

  return excerpts
    .map((excerpt) =>
      [
        `### ${excerpt.id} ${excerpt.title}`,
        "",
        `- ${language === "fr" ? "Source" : "Source"}: ${excerpt.sourceId}`,
        `- ${language === "fr" ? "Ancrage" : "Locator"}: ${excerpt.locator}`,
        "",
        excerpt.text
      ].join("\n")
    )
    .join("\n\n");
}

export function buildDebateMarkdown(exportPayload: DebateExport): string {
  const language = exportPayload.result.meta.language || detectDebateLanguage(exportPayload.settings);

  return [
    language === "fr" ? "# Debat de modeles" : "# Model Debate",
    "",
    `- ${language === "fr" ? "Genere le" : "Generated at"}: ${exportPayload.generatedAt}`,
    `- ${language === "fr" ? "Sujet" : "Topic"}: ${exportPayload.settings.topic}`,
    `- ${language === "fr" ? "Objectif" : "Objective"}: ${exportPayload.settings.objective}`,
    ...(exportPayload.settings.notes.trim()
      ? [`- ${language === "fr" ? "Notes" : "Notes"}: ${exportPayload.settings.notes.replace(/\s+/g, " ").trim()}`]
      : []),
    `- ${exportPayload.settings.participantA.displayName} ${language === "fr" ? "modele" : "model"}: ${exportPayload.result.meta.effectiveModels.participantA}`,
    `- ${exportPayload.settings.participantB.displayName} ${language === "fr" ? "modele" : "model"}: ${exportPayload.result.meta.effectiveModels.participantB}`,
    `- ${language === "fr" ? "Modele de synthese" : "Synthesis model"}: ${exportPayload.result.meta.effectiveModels.synthesis}`,
    `- ${language === "fr" ? "Format de synthese" : "Synthesis format"}: ${getSynthesisFormatLabel(exportPayload.result.meta.synthesisFormat, language)}`,
    ...(exportPayload.sourcePack
      ? [
          `- ${language === "fr" ? "Documents prepares" : "Prepared documents"}: ${exportPayload.sourcePack.files.length}`,
          `- ${language === "fr" ? "Passages prepares" : "Prepared passages"}: ${exportPayload.sourcePack.excerpts.length}`
        ]
      : []),
    "",
    language === "fr" ? "## Synthese" : "## Synthesis",
    "",
    exportPayload.result.synthesis.markdown,
    "",
    language === "fr" ? "## Documents selectionnes" : "## Selected documents",
    "",
    renderSourceFilesMarkdown(exportPayload.sourcePack?.files || [], language),
    "",
    language === "fr" ? "## Passages selectionnes" : "## Selected passages",
    "",
    renderExcerptMarkdown(exportPayload.sourcePack?.excerpts || [], language),
    ...(exportPayload.sourcePack?.warnings.length
      ? [
          "",
          language === "fr" ? "## Avertissements documents" : "## Document warnings",
          "",
          ...exportPayload.sourcePack.warnings.map((warning) => `- ${warning}`)
        ]
      : [])
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
