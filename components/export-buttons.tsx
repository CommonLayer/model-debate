"use client";

import {
  buildDebateExport,
  buildDebateMarkdown,
  downloadTextFile,
  getExportBaseFilename
} from "@/lib/exports";
import type { DebateRunResult, DebateSettings } from "@/lib/types";

type ExportButtonsProps = {
  settings: DebateSettings | null;
  result: DebateRunResult | null;
};

export function ExportButtons({ settings, result }: ExportButtonsProps) {
  const ready = Boolean(settings && result);
  const exportPayload =
    settings && result
      ? buildDebateExport({
          settings,
          result
        })
      : null;
  const baseFilename =
    settings && result ? getExportBaseFilename(settings.topic, result.meta.generatedAt) : "";

  function handleMarkdownExport(): void {
    if (!exportPayload) {
      return;
    }

    downloadTextFile(`${baseFilename}.md`, buildDebateMarkdown(exportPayload), "text/markdown");
  }

  async function handleCopyMarkdown(): Promise<void> {
    if (!exportPayload) {
      return;
    }

    await navigator.clipboard.writeText(buildDebateMarkdown(exportPayload));
  }

  function handleJsonExport(): void {
    if (!exportPayload) {
      return;
    }

    downloadTextFile(
      `${baseFilename}.json`,
      JSON.stringify(exportPayload, null, 2),
      "application/json"
    );
  }

  return (
    <div className="button-row button-row-tight">
      <button
        className="button button-ghost"
        type="button"
        onClick={() => void handleCopyMarkdown()}
        disabled={!ready}
      >
        Copy
      </button>
      <button className="button button-ghost" type="button" onClick={handleMarkdownExport} disabled={!ready}>
        Save .md
      </button>
      <button className="button button-ghost" type="button" onClick={handleJsonExport} disabled={!ready}>
        Save .json
      </button>
    </div>
  );
}
