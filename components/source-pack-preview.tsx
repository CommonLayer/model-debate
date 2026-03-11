"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import type { SourcePack } from "@/lib/types";

type SourcePackPreviewProps = {
  sourcePack: SourcePack;
  stale: boolean;
  sourceLabelsByFileId?: Record<string, string>;
};

function getSourceLabel(
  fileId: string,
  sourceLabelsByFileId: Record<string, string> | undefined,
  fallbackOrigin: string
): string {
  return sourceLabelsByFileId?.[fileId] || fallbackOrigin;
}

export function SourcePackPreview({
  sourcePack,
  stale,
  sourceLabelsByFileId
}: SourcePackPreviewProps) {
  const [showExcerpts, setShowExcerpts] = useState(false);

  return (
    <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">Prepared document pack</div>
          <div className="text-xs text-muted-foreground">
            {sourcePack.files.length} files · {sourcePack.excerpts.length} selected
            {" "}
            passage{sourcePack.excerpts.length > 1 ? "s" : ""}
          </div>
        </div>
        <Badge variant="outline">{stale ? "stale" : "ready"}</Badge>
      </div>

      {sourcePack.warnings.length > 0 ? (
        <div className="space-y-1 text-xs text-amber-100/90">
          {sourcePack.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Selected files
        </div>

        <div className="space-y-2">
          {sourcePack.files.map((file) => {
            const excerptCount = sourcePack.excerpts.filter(
              (excerpt) => excerpt.sourceId === file.id
            ).length;

            return (
              <div
                key={file.id}
                className="rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-sm"
              >
                <div className="truncate font-medium text-foreground">{file.label}</div>
                <div className="text-xs text-muted-foreground">
                  {getSourceLabel(file.id, sourceLabelsByFileId, file.origin)} · {excerptCount} selected
                  {" "}
                  passage{excerptCount > 1 ? "s" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className="text-xs text-foreground underline underline-offset-4 transition-opacity hover:opacity-80"
          onClick={() => setShowExcerpts((current) => !current)}
        >
          {showExcerpts
            ? "Hide selected passages"
            : `Show selected passages (${sourcePack.excerpts.length})`}
        </button>

        {showExcerpts ? (
          <div className="scroll-soft max-h-64 space-y-2 overflow-auto">
            {sourcePack.excerpts.map((excerpt) => (
              <article
                key={excerpt.id}
                className="rounded-lg border border-border/70 bg-background/60 p-3 text-sm"
              >
                <div className="mb-1 font-medium text-foreground">
                  {excerpt.id} {excerpt.title}
                </div>
                <div className="text-xs text-muted-foreground">{excerpt.locator}</div>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
