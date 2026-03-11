"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  FileDown,
  FileText,
  GitBranch,
  LoaderCircle,
  MessagesSquare,
  Shield
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  buildDebateExport,
  buildDebateMarkdown,
  downloadTextFile,
  getExportBaseFilename
} from "@/lib/exports";
import type { PublicDebateDefaults } from "@/lib/server/env";
import type {
  DebateRunResult,
  DebateSettings,
  ModelCatalogEntry,
  ModelCatalogResponse
} from "@/lib/types";

const OPENAI_SHORTLIST = [
  "openai/gpt-5.4",
  "openai/gpt-5.2",
  "openai/gpt-5",
  "openai/gpt-5-mini"
] as const;

const ANTHROPIC_SHORTLIST = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-6"
] as const;

type ModelFieldKey = "participantA" | "participantB" | "synthesis";
type ModelSuggestionScope = "openai" | "anthropic" | "all";

function textareaClassName(): string {
  return [
    "min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  ].join(" ");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function buildFallbackModelEntries(defaults: PublicDebateDefaults): ModelCatalogEntry[] {
  const seen = new Set<string>();

  return [
    {
      id: defaults.participantAModel,
      label: defaults.participantAModel,
      source: "recommended" as const,
      description: "Default model for participant A."
    },
    {
      id: defaults.participantBModel,
      label: defaults.participantBModel,
      source: "recommended" as const,
      description: "Default model for participant B."
    },
    {
      id: defaults.synthesisModel,
      label: defaults.synthesisModel,
      source: "recommended" as const,
      description: "Default model for the final synthesis."
    }
  ].filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);

    return true;
  });
}

function getCatalogSourceLabel(response: ModelCatalogResponse | null): string {
  if (!response) {
    return "recommended defaults";
  }

  if (response.loadedFrom.length === 0) {
    return "recommended defaults";
  }

  return response.loadedFrom.join(" + ");
}

function getModelFieldHint(
  value: string,
  modelsById: Map<string, ModelCatalogEntry>
): string {
  const candidate = value.trim();

  if (!candidate) {
    return "Choose a listed model or enter a custom model ID.";
  }

  const entry = modelsById.get(candidate);

  if (!entry) {
    return "Custom model ID.";
  }

  if (entry.source === "recommended") {
    return "Recommended default.";
  }

  return `Listed from ${entry.source}.`;
}

function buildSuggestedModels(input: {
  availableModelsById: Map<string, ModelCatalogEntry>;
  fallbackModelEntries: ModelCatalogEntry[];
  currentValues: string[];
}): ModelCatalogEntry[] {
  const preferredIds = [...OPENAI_SHORTLIST, ...ANTHROPIC_SHORTLIST];
  const seen = new Set<string>();
  const entries: ModelCatalogEntry[] = [];

  for (const id of preferredIds) {
    const entry = input.availableModelsById.get(id);

    if (!entry || seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  for (const entry of input.fallbackModelEntries) {
    if (seen.has(entry.id)) {
      continue;
    }

    seen.add(entry.id);
    entries.push(entry);
  }

  for (const currentValue of input.currentValues) {
    const candidate = currentValue.trim();

    if (!candidate || seen.has(candidate)) {
      continue;
    }

    const entry = input.availableModelsById.get(candidate);

    if (entry) {
      seen.add(entry.id);
      entries.push(entry);
      continue;
    }

    seen.add(candidate);
    entries.push({
      id: candidate,
      label: candidate,
      source: "recommended",
      description: "Custom model ID."
    });
  }

  return entries;
}

function buildScopedSuggestedModels(input: {
  models: ModelCatalogEntry[];
  scope: ModelSuggestionScope;
  currentValue: string;
}): ModelCatalogEntry[] {
  const baseModels =
    input.scope === "all"
      ? input.models
      : input.models.filter((entry) =>
          input.scope === "openai"
            ? entry.id.startsWith("openai/")
            : entry.id.startsWith("anthropic/")
        );

  const candidate = input.currentValue.trim();

  if (!candidate || baseModels.some((entry) => entry.id === candidate)) {
    return baseModels;
  }

  return [
    {
      id: candidate,
      label: candidate,
      source: "recommended",
      description: "Custom model ID."
    },
    ...baseModels
  ];
}

type DebateWorkbenchProps = {
  defaults: PublicDebateDefaults;
};

export function DebateWorkbench({ defaults }: DebateWorkbenchProps) {
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [rounds, setRounds] = useState(defaults.rounds);
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [participantAModel, setParticipantAModel] = useState(defaults.participantAModel);
  const [participantBModel, setParticipantBModel] = useState(defaults.participantBModel);
  const [synthesisModel, setSynthesisModel] = useState(defaults.synthesisModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebateRunResult | null>(null);
  const [lastRunSettings, setLastRunSettings] = useState<DebateSettings | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogResponse | null>(null);
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [openModelMenu, setOpenModelMenu] = useState<ModelFieldKey | null>(null);
  const openrouterApiKeyRef = useRef(openrouterApiKey);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const fallbackModelEntries = useMemo(() => buildFallbackModelEntries(defaults), [defaults]);
  const availableModels = modelCatalog?.models.length ? modelCatalog.models : fallbackModelEntries;
  const availableModelsById = useMemo(
    () => new Map(availableModels.map((entry) => [entry.id, entry])),
    [availableModels]
  );
  const suggestedModels = useMemo(
    () =>
      buildSuggestedModels({
        availableModelsById,
        fallbackModelEntries,
        currentValues: [participantAModel, participantBModel, synthesisModel]
      }),
    [availableModelsById, fallbackModelEntries, participantAModel, participantBModel, synthesisModel]
  );
  const openAiSuggestedModels = useMemo(
    () =>
      buildScopedSuggestedModels({
        models: suggestedModels,
        scope: "openai",
        currentValue: participantAModel
      }),
    [participantAModel, suggestedModels]
  );
  const claudeSuggestedModels = useMemo(
    () =>
      buildScopedSuggestedModels({
        models: suggestedModels,
        scope: "anthropic",
        currentValue: participantBModel
      }),
    [participantBModel, suggestedModels]
  );
  const synthesisSuggestedModels = useMemo(
    () =>
      buildScopedSuggestedModels({
        models: suggestedModels,
        scope: "all",
        currentValue: synthesisModel
      }),
    [suggestedModels, synthesisModel]
  );

  const transcriptWordCount = useMemo(() => {
    if (!result) {
      return 0;
    }

    return result.transcript
      .map((turn) => turn.text.split(/\s+/).filter(Boolean).length)
      .reduce((sum, count) => sum + count, 0);
  }, [result]);

  const workingDoc = result?.synthesis.markdown ?? "";
  const currentModels = result?.meta.effectiveModels ?? {
    participantA: participantAModel.trim() || defaults.participantAModel,
    participantB: participantBModel.trim() || defaults.participantBModel,
    synthesis: synthesisModel.trim() || defaults.synthesisModel
  };
  const routingBadge =
    result?.meta.provider ?? modelCatalog?.mode ?? (openrouterApiKey.trim() ? "openrouter" : "auto");
  const providersUsed = result?.meta.providersUsed ?? [];
  const shouldRefreshWithUiKey =
    !!openrouterApiKey.trim() && modelCatalog?.credentialSource !== "ui";

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (!modelMenuRef.current?.contains(event.target as Node)) {
        setOpenModelMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  useEffect(() => {
    openrouterApiKeyRef.current = openrouterApiKey;
  }, [openrouterApiKey]);

  const loadModelCatalog = useCallback(async (useUiKey = false): Promise<void> => {
    setModelCatalogBusy(true);
    setModelCatalogError(null);

    try {
      const response = await fetch("/api/models", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          apiKey: useUiKey ? openrouterApiKeyRef.current.trim() || undefined : undefined
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | (ModelCatalogResponse & { error?: string; details?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      if (!payload || !Array.isArray(payload.models)) {
        throw new Error("Invalid model catalog response");
      }

      startTransition(() => {
        setModelCatalog(payload);
      });
    } catch (catalogError) {
      setModelCatalogError(toErrorMessage(catalogError));
    } finally {
      setModelCatalogBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadModelCatalog(false);
  }, [loadModelCatalog]);

  async function handleRun(): Promise<void> {
    setBusy(true);
    setError(null);

    const requestSettings: DebateSettings = {
      topic: topic.trim(),
      objective: objective.trim(),
      rounds: Math.max(1, Math.min(5, Math.trunc(rounds || defaults.rounds))),
      participantA: {
        slot: "A",
        model: participantAModel.trim()
      },
      participantB: {
        slot: "B",
        model: participantBModel.trim()
      },
      synthesisModel: synthesisModel.trim()
    };

    try {
      const response = await fetch("/api/debate", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          topic: requestSettings.topic,
          objective: requestSettings.objective,
          rounds: requestSettings.rounds,
          participantA: {
            model: requestSettings.participantA.model
          },
          participantB: {
            model: requestSettings.participantB.model
          },
          synthesisModel: requestSettings.synthesisModel,
          apiKey: openrouterApiKey.trim() || undefined
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | (DebateRunResult & { error?: string; details?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      if (!payload?.synthesis || !Array.isArray(payload.transcript)) {
        throw new Error("Invalid debate response");
      }

      const effectiveSettings: DebateSettings = {
        topic: requestSettings.topic,
        objective: requestSettings.objective,
        rounds: payload.meta.rounds,
        participantA: {
          slot: "A",
          model: payload.meta.effectiveModels.participantA
        },
        participantB: {
          slot: "B",
          model: payload.meta.effectiveModels.participantB
        },
        synthesisModel: payload.meta.effectiveModels.synthesis
      };

      startTransition(() => {
        setLastRunSettings(effectiveSettings);
        setResult(payload);
      });
    } catch (runError) {
      setError(toErrorMessage(runError));
    } finally {
      setBusy(false);
    }
  }

  function handleSaveMarkdown(): void {
    if (!lastRunSettings || !result) {
      return;
    }

    const exportPayload = buildDebateExport({
      settings: lastRunSettings,
      result
    });
    const filename = `${getExportBaseFilename(lastRunSettings.topic, result.meta.generatedAt)}.md`;

    downloadTextFile(filename, buildDebateMarkdown(exportPayload), "text/markdown");
  }

  function handleSaveJson(): void {
    if (!lastRunSettings || !result) {
      return;
    }

    const exportPayload = buildDebateExport({
      settings: lastRunSettings,
      result
    });
    const filename = `${getExportBaseFilename(lastRunSettings.topic, result.meta.generatedAt)}.json`;

    downloadTextFile(filename, JSON.stringify(exportPayload, null, 2), "application/json");
  }

  async function handleCopyTranscript(): Promise<void> {
    if (!result) {
      return;
    }

    await copyText(
      result.transcript
        .map(
          (turn) =>
            `${turn.model} · ROUND ${turn.round} · ${turn.participant === "A" ? "MODEL A" : "MODEL B"}\n${turn.text}`
        )
        .join("\n\n")
    );
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-6">
          <Card className="overflow-hidden border-sky-500/20 bg-card/95">
            <CardHeader className="space-y-3 border-b border-border/70 bg-gradient-to-br from-sky-500/10 via-transparent to-emerald-500/10">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-100">
                    Model Debate
                  </Badge>
                  <CardTitle className="text-lg">2-model debate</CardTitle>
                </div>
                <div className="rounded-full border border-border/80 bg-background/50 p-2 text-sky-100">
                  <MessagesSquare className="h-4 w-4" />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Local workbench for structured model-vs-model runs, with a transcript, a working
                synthesis, and exportable outputs.
              </p>
            </CardHeader>

            <CardContent className="space-y-4 p-4">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100/90">
                The UI key is never persisted. It is sent only to this local route for the current
                run and overrides the environment OpenRouter key for this session.
              </div>

              <div className="space-y-3 rounded-lg border border-border/80 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Mode</p>
                    <p className="text-sm text-foreground">
                      Public v1 runs exactly two participants and one synthesis pass.
                    </p>
                  </div>
                  <Badge variant="outline">debate</Badge>
                </div>

                <div className="grid gap-2">
                  <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-left">
                    <div className="text-sm font-medium text-foreground">2-model debate</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Model A starts each round, model B answers, and the synthesis model writes
                      the final working doc.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/80 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Routing</p>
                    <p className="text-sm text-foreground">
                      OpenRouter stays first; direct provider env keys are the fallback path.
                    </p>
                  </div>
                  <Badge variant="outline">{routingBadge}</Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div
                    className={
                      routingBadge === "openrouter"
                        ? "rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-left"
                        : "rounded-lg border border-border/80 bg-background/50 p-3 text-left"
                    }
                  >
                    <div className="text-sm font-medium text-foreground">OpenRouter first</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use the UI key or <span className="font-mono">OPENROUTER_API_KEY</span>.
                    </p>
                  </div>

                  <div
                    className={
                      routingBadge === "direct"
                        ? "rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-left"
                        : "rounded-lg border border-border/80 bg-background/50 p-3 text-left"
                    }
                  >
                    <div className="text-sm font-medium text-foreground">Direct env fallback</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Falls back to <span className="font-mono">OPENAI_API_KEY</span> and
                      <span className="font-mono"> ANTHROPIC_API_KEY</span> when OpenRouter is not
                      configured.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3">
                <label className="space-y-1 text-xs text-muted-foreground">
                  OpenRouter key
                  <Input
                    autoComplete="off"
                    type="password"
                    value={openrouterApiKey}
                    onChange={(event) => setOpenrouterApiKey(event.target.value)}
                    placeholder="sk-or-v1-..."
                  />
                </label>

                <div className="space-y-3 rounded-lg border border-border/80 bg-background/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">
                        Model catalog
                      </p>
                      <p className="text-sm text-foreground">
                        {modelCatalogBusy
                          ? "Refreshing models for the current keys."
                          : `${suggestedModels.length} suggested models loaded from ${getCatalogSourceLabel(
                              modelCatalog
                            )}.`}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={modelCatalogBusy}
                      onClick={() => void loadModelCatalog(true)}
                    >
                      {modelCatalogBusy ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Refresh models
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Pick from a short suggestion list or type a custom model ID in the same field.
                  </p>

                  {shouldRefreshWithUiKey ? (
                    <p className="text-xs text-sky-200">
                      An OpenRouter key is present in the UI. Click refresh to load the catalog for
                      that session key.
                    </p>
                  ) : null}

                  {modelCatalogError ? (
                    <p className="text-xs text-rose-300">{modelCatalogError}</p>
                  ) : null}

                  {modelCatalog?.warnings.map((warning) => (
                    <p key={warning} className="text-xs text-amber-100/90">
                      {warning}
                    </p>
                  ))}

                  <div className="rounded-lg border border-border/70 bg-background/50 p-3 text-xs">
                    <div className="font-medium text-foreground">Recommended defaults</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-muted-foreground">
                      {fallbackModelEntries.map((entry) => (
                        <span
                          key={entry.id}
                          className="rounded-full border border-border/70 bg-background/70 px-2 py-1 font-mono"
                        >
                          {entry.id}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div ref={modelMenuRef} className="grid gap-3">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    Model OpenAI
                    <div className="relative">
                      <Input
                        autoComplete="off"
                        value={participantAModel}
                        onChange={(event) => setParticipantAModel(event.target.value)}
                        onFocus={() => setOpenModelMenu("participantA")}
                        className="pr-11"
                      />
                      <button
                        type="button"
                        aria-label="Toggle OpenAI model suggestions"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                        onClick={() =>
                          setOpenModelMenu((current) =>
                            current === "participantA" ? null : "participantA"
                          )
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>

                      {openModelMenu === "participantA" ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-72 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-2xl">
                          {openAiSuggestedModels.map((entry) => (
                            <button
                              key={`participant-a-${entry.id}`}
                              type="button"
                              className="block w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-accent"
                              onClick={() => {
                                setParticipantAModel(entry.id);
                                setOpenModelMenu(null);
                              }}
                            >
                              <div className="text-sm font-medium text-foreground">{entry.id}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span className="block text-[11px] text-muted-foreground">
                      {getModelFieldHint(participantAModel, availableModelsById)}
                    </span>
                  </label>

                  <label className="space-y-1 text-xs text-muted-foreground">
                    Model Claude
                    <div className="relative">
                      <Input
                        autoComplete="off"
                        value={participantBModel}
                        onChange={(event) => setParticipantBModel(event.target.value)}
                        onFocus={() => setOpenModelMenu("participantB")}
                        className="pr-11"
                      />
                      <button
                        type="button"
                        aria-label="Toggle Claude model suggestions"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                        onClick={() =>
                          setOpenModelMenu((current) =>
                            current === "participantB" ? null : "participantB"
                          )
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>

                      {openModelMenu === "participantB" ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-72 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-2xl">
                          {claudeSuggestedModels.map((entry) => (
                            <button
                              key={`participant-b-${entry.id}`}
                              type="button"
                              className="block w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-accent"
                              onClick={() => {
                                setParticipantBModel(entry.id);
                                setOpenModelMenu(null);
                              }}
                            >
                              <div className="text-sm font-medium text-foreground">{entry.id}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span className="block text-[11px] text-muted-foreground">
                      {getModelFieldHint(participantBModel, availableModelsById)}
                    </span>
                  </label>

                  <label className="space-y-1 text-xs text-muted-foreground">
                    Synthesis model
                    <div className="relative">
                      <Input
                        autoComplete="off"
                        value={synthesisModel}
                        onChange={(event) => setSynthesisModel(event.target.value)}
                        onFocus={() => setOpenModelMenu("synthesis")}
                        className="pr-11"
                      />
                      <button
                        type="button"
                        aria-label="Toggle synthesis model suggestions"
                        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground"
                        onClick={() =>
                          setOpenModelMenu((current) =>
                            current === "synthesis" ? null : "synthesis"
                          )
                        }
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>

                      {openModelMenu === "synthesis" ? (
                        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 max-h-72 overflow-auto rounded-2xl border border-border bg-popover p-2 shadow-2xl">
                          {synthesisSuggestedModels.map((entry) => (
                            <button
                              key={`synthesis-${entry.id}`}
                              type="button"
                              className="block w-full rounded-xl px-4 py-3 text-left transition-colors hover:bg-accent"
                              onClick={() => {
                                setSynthesisModel(entry.id);
                                setOpenModelMenu(null);
                              }}
                            >
                              <div className="text-sm font-medium text-foreground">{entry.id}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <span className="block text-[11px] text-muted-foreground">
                      {getModelFieldHint(synthesisModel, availableModelsById)}
                    </span>
                  </label>
                </div>
              </div>

              <label className="space-y-1 text-xs text-muted-foreground">
                Topic
                <textarea
                  className={textareaClassName()}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="What should the two models debate?"
                />
              </label>

              <label className="space-y-1 text-xs text-muted-foreground">
                Objective
                <textarea
                  className={textareaClassName()}
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  placeholder="What should the synthesis resolve or recommend?"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-muted-foreground">
                  Rounds
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={rounds}
                    onChange={(event) => setRounds(Number(event.target.value) || defaults.rounds)}
                  />
                </label>

                <div className="space-y-2 pt-5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-sky-400" />
                    UI key overrides env only for the current session
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    Markdown and JSON exports never include API keys
                  </div>
                </div>
              </div>

              <Button onClick={() => void handleRun()} disabled={busy} className="w-full gap-2">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                Run debate
              </Button>

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6">
          <Card className="border-border/80 bg-card/95">
            <CardHeader className="border-b border-border/70">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge variant="outline">Transcript</Badge>
                  <CardTitle className="mt-2 text-lg">Debate</CardTitle>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{result?.transcript.length ?? 0} turns</div>
                    <div>{transcriptWordCount} words</div>
                  </div>
                  <Button variant="outline" size="sm" disabled={!result} onClick={() => void handleCopyTranscript()}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="scroll-soft max-h-[42vh] space-y-3 overflow-auto p-4">
              {result ? (
                result.transcript.map((turn) => (
                  <article
                    key={`${turn.participant}-${turn.round}-${turn.model}`}
                    className={
                      turn.participant === "A"
                        ? "rounded-lg border border-sky-500/30 bg-sky-500/10 p-3"
                        : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                    }
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {turn.model}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Round {turn.round}</span>
                          <span>•</span>
                          <span>{turn.participant === "A" ? "Model A" : "Model B"}</span>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {turn.participant === "A" ? "A" : "B"}
                      </Badge>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">{turn.text}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border/80 bg-background/40 p-6 text-sm text-muted-foreground">
                  The transcript appears here turn by turn, with the selected models responding
                  across each round.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="border-emerald-500/20 bg-card/95">
              <CardHeader className="border-b border-border/70">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-100">
                      Working Doc
                    </Badge>
                    <CardTitle className="mt-2 text-lg">Debate synthesis</CardTitle>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!workingDoc}
                      onClick={() => void copyText(workingDoc)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" disabled={!result} onClick={handleSaveMarkdown}>
                      <FileDown className="mr-2 h-4 w-4" />
                      Save .md
                    </Button>
                    <Button variant="outline" size="sm" disabled={!result} onClick={handleSaveJson}>
                      <FileText className="mr-2 h-4 w-4" />
                      Save .json
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4">
                {result ? (
                  <pre className="scroll-soft max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-lg border border-border/80 bg-background/60 p-4 text-sm leading-6 text-foreground">
                    {workingDoc}
                  </pre>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/80 bg-background/40 p-6 text-sm text-muted-foreground">
                    Run a debate to generate a Markdown working doc that captures the strongest
                    arguments, unresolved tensions, and next actions.
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-border/80 bg-card/95">
                <CardHeader className="border-b border-border/70">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Badge variant="outline">Meta</Badge>
                      <CardTitle className="mt-2 text-lg">Run context</CardTitle>
                    </div>
                    <Shield className="h-4 w-4 text-muted-foreground" />
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 p-4 text-sm">
                  <p className="text-muted-foreground">
                    {result
                      ? `Provider mode: ${result.meta.provider}. Exactly two participants, one synthesis, and sanitized exports.`
                      : "No completed run yet. Defaults are loaded from the environment until you start a debate."}
                  </p>

                  <div className="rounded-lg border border-border/80 bg-background/50 p-3 text-xs text-foreground">
                    <div className="font-medium">Models in scope</div>
                    <div className="mt-1 text-muted-foreground">
                      A: {currentModels.participantA}
                      <br />
                      B: {currentModels.participantB}
                      <br />
                      Synthesis: {currentModels.synthesis}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(providersUsed.length > 0 ? providersUsed : ["openrouter-first"]).map((item) => (
                      <Badge key={item} variant="outline">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-border/80 bg-card/95">
                <CardHeader className="border-b border-border/70">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full border border-border/80 bg-background/50 p-2 text-muted-foreground">
                      <FileText className="h-4 w-4" />
                    </div>
                    <CardTitle className="text-lg">Suggested usage</CardTitle>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
                  <p>1. Start with 2 rounds for the first pass.</p>
                  <p>2. Tighten the topic if the debate stays too broad after reading the working doc.</p>
                  <p>3. Export Markdown once the synthesis becomes actionable enough to reuse.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
