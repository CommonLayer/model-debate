"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileUp,
  ChevronDown,
  Copy,
  FileDown,
  FileText,
  FolderOpen,
  Github,
  GitBranch,
  LoaderCircle,
  MessagesSquare,
  RefreshCcw,
  Shield
} from "lucide-react";

import { MarkdownRenderer } from "@/components/markdown-renderer";
import { SourcePackPreview } from "@/components/source-pack-preview";
import { SourceTreeBrowser } from "@/components/source-tree-browser";
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
import {
  DEFAULT_BUILDER_DISPLAY_NAME,
  DEFAULT_CRITIC_DISPLAY_NAME,
  detectDebateLanguage,
  getSynthesisSectionTitles,
  resolveSynthesisFormat
} from "@/lib/prompts";
import type { PublicDebateDefaults } from "@/lib/server/env";
import type {
  DebateRunResult,
  DebateSettings,
  DebateSynthesisFormat,
  DebateStreamEvent,
  DebateStreamStatusEvent,
  DebateTurn,
  GitHubSourceTreeResponse,
  ModelCatalogEntry,
  ModelCatalogResponse,
  SourcePack,
  SourceTreeNode
} from "@/lib/types";

const SUGGESTED_MODEL_SHORTLIST = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-6",
  "openai/gpt-5.4",
  "openai/gpt-5.2",
  "openai/gpt-5",
  "openai/gpt-5-mini"
] as const;

const SYNTHESIS_FORMAT_OPTIONS: Array<{
  id: DebateSynthesisFormat;
  label: string;
  description: string;
}> = [
  {
    id: "auto",
    label: "Auto",
    description: "Pick the format from the topic, objective, and notes."
  },
  {
    id: "tech_architecture",
    label: "Tech / Architecture",
    description: "Best for code, systems, repo structure, and technical foundations."
  },
  {
    id: "decision_strategy",
    label: "Decision / Strategy",
    description: "Best for scope choices, product direction, and prioritization."
  },
  {
    id: "factual_practical",
    label: "Factual / Practical",
    description: "Best for health, admin, legal, and practical everyday answers."
  },
  {
    id: "proof_validation",
    label: "Proof / Validation",
    description: "Best for testing hypotheses, metrics, audits, and validation plans."
  }
];

const CLIENT_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "out"
]);
const CLIENT_ALLOWED_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".conf",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".kts",
  ".less",
  ".log",
  ".lua",
  ".m",
  ".md",
  ".mdx",
  ".mjs",
  ".pdf",
  ".php",
  ".pl",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".sql",
  ".svg",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml"
]);
const CLIENT_SPECIAL_TEXT_FILENAMES = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  "Dockerfile",
  "Gemfile",
  "LICENSE",
  "Makefile",
  "Procfile",
  "README",
  "README.md",
  "README.mdx"
]);

type ModelFieldKey = "participantA" | "participantB" | "synthesis";
type ModelSuggestionScope = "all";
type RunProgressStep = {
  id: string;
  kind: "setup" | "turn" | "synthesis" | "finalize";
  label: string;
  detail: string;
  round?: number;
  participant?: "A" | "B";
  model?: string;
};
type UploadSelection = {
  file: File;
  label: string;
  key: string;
};
type WindowWithDirectoryPicker = Window & {
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
};
type FileSystemHandleWithEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterable<[string, FileSystemHandle]>;
};
type ImportedRepoTree = {
  rootLabel: string;
  nodes: SourceTreeNode[];
  fileHandlesByPath: Record<string, FileSystemFileHandle>;
};

function textareaClassName(): string {
  return [
    "min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm",
    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  ].join(" ");
}

function togglePathSelection(paths: string[], nextPath: string): string[] {
  return paths.includes(nextPath)
    ? paths.filter((path) => path !== nextPath)
    : [...paths, nextPath].sort((left, right) =>
        left.localeCompare(right, "en", { sensitivity: "base" })
      );
}

function buildSourceSignature(input: {
  topic: string;
  objective: string;
  uploadFiles: UploadSelection[];
  importedRepoSelectedPaths: string[];
  workspacePaths: string[];
  githubRepoUrl: string;
  githubRef: string;
  githubPaths: string[];
}): string {
  return JSON.stringify({
    topic: input.topic.trim(),
    objective: input.objective.trim(),
    uploads: input.uploadFiles.map((item) => ({
      name: item.label,
      size: item.file.size,
      lastModified: item.file.lastModified
    })),
    importedRepoSelectedPaths: [...input.importedRepoSelectedPaths].sort(),
    workspacePaths: [...input.workspacePaths].sort(),
    githubRepoUrl: input.githubRepoUrl.trim(),
    githubRef: input.githubRef.trim(),
    githubPaths: [...input.githubPaths].sort()
  });
}

function toUploadKey(file: File, label: string): string {
  return `${label}:${file.size}:${file.lastModified}`;
}

function normalizeClientSourcePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function getTranscriptSpeakerLabel(modelId: string): string {
  const trimmed = modelId.trim();

  if (!trimmed) {
    return "Unknown model";
  }

  return trimmed.includes("/") ? trimmed.split("/").slice(1).join("/") : trimmed;
}

function getSynthesisFormatLabel(format: DebateSynthesisFormat): string {
  return SYNTHESIS_FORMAT_OPTIONS.find((option) => option.id === format)?.label || "Auto";
}

function buildRunProgressSteps(settings: DebateSettings): RunProgressStep[] {
  const steps: RunProgressStep[] = [
    {
      id: "prepare",
      kind: "setup",
      label: "Preparing debate",
      detail: settings.notes.trim()
        ? "Locking the brief, notes, and source pack before the first turn."
        : "Locking the topic, objective, and source pack before the first turn."
    }
  ];

  for (let round = 1; round <= settings.rounds; round += 1) {
    steps.push({
      id: `round-${round}-critic`,
      kind: "turn",
      label: `Round ${round}: ${getTranscriptSpeakerLabel(settings.participantA.modelId)}`,
      detail: "Opening the round by pressure-testing the thesis, fragilities, and invariants.",
      round,
      participant: "A",
      model: settings.participantA.modelId
    });
    steps.push({
      id: `round-${round}-builder`,
      kind: "turn",
      label: `Round ${round}: ${getTranscriptSpeakerLabel(settings.participantB.modelId)}`,
      detail: "Answering the critique with executable architecture, sequencing, and safeguards.",
      round,
      participant: "B",
      model: settings.participantB.modelId
    });
  }

  steps.push({
    id: "synthesis",
    kind: "synthesis",
    label: "Writing synthesis",
    detail: `Drafting the working doc with ${getTranscriptSpeakerLabel(settings.synthesisModel)} from the full debate transcript.`
  });
  steps.push({
    id: "finalize",
    kind: "finalize",
    label: "Finalizing run",
    detail: "Sanitizing the final payload so transcript, synthesis, and exports can render together."
  });

  return steps;
}

function getRunStepState(
  stepIndex: number,
  activeStepIndex: number
): "active" | "queued" | "up-next" {
  if (stepIndex === activeStepIndex) {
    return "active";
  }

  if (stepIndex < activeStepIndex) {
    return "queued";
  }

  return "up-next";
}

function getStepIdForStatusEvent(event: DebateStreamStatusEvent): string {
  if (event.stage === "prepare") {
    return "prepare";
  }

  if (event.stage === "turn_start" || event.stage === "turn_complete") {
    if (typeof event.round === "number" && (event.participant === "A" || event.participant === "B")) {
      return `round-${event.round}-${event.participant === "A" ? "critic" : "builder"}`;
    }
  }

  if (event.stage === "synthesis_start") {
    return "synthesis";
  }

  return "finalize";
}

function sanitizeTranscriptText(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function isSupportedImportedRepoPath(filepath: string): boolean {
  const normalized = normalizeClientSourcePath(filepath);

  if (!normalized) {
    return false;
  }

  const segments = normalized.split("/");
  const basename = segments[segments.length - 1] || "";
  const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".")).toLowerCase() : "";

  if (segments.some((segment) => CLIENT_IGNORED_DIRECTORY_NAMES.has(segment))) {
    return false;
  }

  if (/\.min\.(js|css)$/i.test(normalized)) {
    return false;
  }

  return CLIENT_ALLOWED_FILE_EXTENSIONS.has(extension) || CLIENT_SPECIAL_TEXT_FILENAMES.has(basename);
}

function buildClientSourceTree(paths: string[], rootLabel: string): SourceTreeNode[] {
  const root: SourceTreeNode[] = [];

  for (const filepath of paths) {
    const segments = normalizeClientSourcePath(filepath).split("/");
    let currentLevel = root;
    let currentPath = "";

    for (const [index, segment] of segments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;

      if (isLeaf) {
        currentLevel.push({
          id: `${rootLabel}:${currentPath}`,
          name: segment,
          path: normalizeClientSourcePath(filepath),
          kind: "file"
        });
        continue;
      }

      let directory = currentLevel.find(
        (node) => node.kind === "directory" && node.path === currentPath
      );

      if (!directory) {
        directory = {
          id: `${rootLabel}:dir:${currentPath}`,
          name: segment,
          path: currentPath,
          kind: "directory",
          children: []
        };
        currentLevel.push(directory);
      }

      currentLevel = directory.children || [];
      directory.children = currentLevel;
    }
  }

  const sortNodes = (nodes: SourceTreeNode[]): void => {
    nodes.sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "en", { sensitivity: "base" });
    });

    for (const node of nodes) {
      if (node.kind === "directory" && node.children) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(root);

  return root;
}

async function collectDirectoryTree(
  handle: FileSystemDirectoryHandle,
  prefix = handle.name
): Promise<ImportedRepoTree> {
  const fileHandlesByPath: Record<string, FileSystemFileHandle> = {};
  const iterableHandle = handle as FileSystemHandleWithEntries;

  for await (const [entryName, entry] of iterableHandle.entries()) {
    const relativePath = normalizeClientSourcePath(`${prefix}/${entryName}`);

    if (entry.kind === "file") {
      if (!isSupportedImportedRepoPath(relativePath)) {
        continue;
      }

      fileHandlesByPath[relativePath] = entry as FileSystemFileHandle;
      continue;
    }

    if (CLIENT_IGNORED_DIRECTORY_NAMES.has(entryName)) {
      continue;
    }

    const nested = await collectDirectoryTree(
      entry as FileSystemDirectoryHandle,
      `${prefix}/${entryName}`
    );

    Object.assign(fileHandlesByPath, nested.fileHandlesByPath);
  }

  const paths = Object.keys(fileHandlesByPath).sort((left, right) =>
    left.localeCompare(right, "en", { sensitivity: "base" })
  );

  return {
    rootLabel: handle.name,
    nodes: buildClientSourceTree(paths, handle.name),
    fileHandlesByPath
  };
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
      description: "Default model for the critic role."
    },
    {
      id: defaults.participantBModel,
      label: defaults.participantBModel,
      source: "recommended" as const,
      description: "Default model for the builder role."
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
  const seen = new Set<string>();
  const entries: ModelCatalogEntry[] = [];

  for (const id of SUGGESTED_MODEL_SHORTLIST) {
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
  const baseModels = input.models;

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
  const [notes, setNotes] = useState("");
  const [synthesisFormat, setSynthesisFormat] = useState<DebateSynthesisFormat>("auto");
  const [rounds, setRounds] = useState(defaults.rounds);
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [participantAModel, setParticipantAModel] = useState(defaults.participantAModel);
  const [participantBModel, setParticipantBModel] = useState(defaults.participantBModel);
  const [synthesisModel, setSynthesisModel] = useState(defaults.synthesisModel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DebateRunResult | null>(null);
  const [activeRunSettings, setActiveRunSettings] = useState<DebateSettings | null>(null);
  const [activeRunStepIndex, setActiveRunStepIndex] = useState(0);
  const [activeRunMessage, setActiveRunMessage] = useState<string | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<DebateTurn[]>([]);
  const [lastRunSettings, setLastRunSettings] = useState<DebateSettings | null>(null);
  const [lastRunSourcePack, setLastRunSourcePack] = useState<SourcePack | null>(null);
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogResponse | null>(null);
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [openModelMenu, setOpenModelMenu] = useState<ModelFieldKey | null>(null);
  const [uploadFiles, setUploadFiles] = useState<UploadSelection[]>([]);
  const [importedRepoTree, setImportedRepoTree] = useState<ImportedRepoTree | null>(null);
  const [importedRepoSelectedPaths, setImportedRepoSelectedPaths] = useState<string[]>([]);
  const [importedRepoBusy, setImportedRepoBusy] = useState(false);
  const [importedRepoSearch, setImportedRepoSearch] = useState("");
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubRef, setGithubRef] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [githubTree, setGithubTree] = useState<GitHubSourceTreeResponse | null>(null);
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [githubSearch, setGithubSearch] = useState("");
  const [githubSelectedPaths, setGithubSelectedPaths] = useState<string[]>([]);
  const [sourcePack, setSourcePack] = useState<SourcePack | null>(null);
  const [sourcePackBusy, setSourcePackBusy] = useState(false);
  const [sourcePackError, setSourcePackError] = useState<string | null>(null);
  const [preparedSourceSignature, setPreparedSourceSignature] = useState<string | null>(null);
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
  const criticSuggestedModels = useMemo(
    () =>
      buildScopedSuggestedModels({
        models: suggestedModels,
        scope: "all",
        currentValue: participantAModel
      }),
    [participantAModel, suggestedModels]
  );
  const builderSuggestedModels = useMemo(
    () =>
      buildScopedSuggestedModels({
        models: suggestedModels,
        scope: "all",
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
  const hasSelectedSources =
    uploadFiles.length > 0 || importedRepoSelectedPaths.length > 0 || githubSelectedPaths.length > 0;
  const currentSourceSignature = useMemo(
    () =>
      buildSourceSignature({
        topic,
        objective,
        uploadFiles,
        importedRepoSelectedPaths,
        workspacePaths: [],
        githubRepoUrl,
        githubRef,
        githubPaths: githubSelectedPaths
      }),
    [
      githubRef,
      githubRepoUrl,
      githubSelectedPaths,
      importedRepoSelectedPaths,
      objective,
      topic,
      uploadFiles
    ]
  );
  const sourcePackStale =
    hasSelectedSources &&
    !!sourcePack &&
    !!preparedSourceSignature &&
    preparedSourceSignature !== currentSourceSignature;
  const preparedSourceLabelsByFileId = useMemo(() => {
    if (!sourcePack) {
      return {};
    }

    const labels: Record<string, string> = {};
    const uploadLabelSet = new Set(uploadFiles.map((item) => item.label));
    const importedRepoLabelSet = new Set(importedRepoSelectedPaths);

    for (const file of sourcePack.files) {
      if (importedRepoLabelSet.has(file.label)) {
        labels[file.id] = "imported repo";
        continue;
      }

      if (uploadLabelSet.has(file.label)) {
        labels[file.id] = "upload";
      }
    }

    return labels;
  }, [importedRepoSelectedPaths, sourcePack, uploadFiles]);

  const displayedTranscript = result?.transcript ?? liveTranscript;
  const transcriptWordCount = useMemo(() => {
    if (displayedTranscript.length === 0) {
      return 0;
    }

    return displayedTranscript
      .map((turn) => turn.text.split(/\s+/).filter(Boolean).length)
      .reduce((sum, count) => sum + count, 0);
  }, [displayedTranscript]);

  const workingDoc = result?.synthesis.markdown ?? "";
  const currentModels = result?.meta.effectiveModels ?? {
    participantA: participantAModel.trim() || defaults.participantAModel,
    participantB: participantBModel.trim() || defaults.participantBModel,
    synthesis: synthesisModel.trim() || defaults.synthesisModel
  };
  const currentParticipants = result?.meta.participants ?? {
    participantA: {
      displayName: DEFAULT_CRITIC_DISPLAY_NAME,
      rolePreset: "critic" as const
    },
    participantB: {
      displayName: DEFAULT_BUILDER_DISPLAY_NAME,
      rolePreset: "builder" as const
    }
  };
  const currentSynthesisFormat = result?.meta.synthesisFormat ?? synthesisFormat;
  const activeRunLanguage = activeRunSettings ? detectDebateLanguage(activeRunSettings) : null;
  const activeRunResolvedFormat = activeRunSettings
    ? resolveSynthesisFormat(activeRunSettings)
    : null;
  const activeRunSynthesisSections =
    activeRunLanguage && activeRunResolvedFormat
      ? getSynthesisSectionTitles(activeRunLanguage, activeRunResolvedFormat)
      : [];
  const routingBadge =
    result?.meta.provider ?? modelCatalog?.mode ?? (openrouterApiKey.trim() ? "openrouter" : "auto");
  const providersUsed = result?.meta.providersUsed ?? [];
  const shouldRefreshWithUiKey =
    !!openrouterApiKey.trim() && modelCatalog?.credentialSource !== "ui";
  const runProgressSteps = useMemo(
    () => (activeRunSettings ? buildRunProgressSteps(activeRunSettings) : []),
    [activeRunSettings]
  );
  const activeRunStep =
    runProgressSteps[Math.min(activeRunStepIndex, Math.max(0, runProgressSteps.length - 1))] || null;
  const activeRunTurnSteps = runProgressSteps.filter(
    (step): step is RunProgressStep & { kind: "turn"; round: number; participant: "A" | "B"; model: string } =>
      step.kind === "turn" &&
      typeof step.round === "number" &&
      (step.participant === "A" || step.participant === "B") &&
      typeof step.model === "string"
  );
  const showRunProgress = busy && !!activeRunSettings;
  const transcriptSummaryPrimary = showRunProgress
    ? `${liveTranscript.length}/${activeRunTurnSteps.length} turns`
    : `${displayedTranscript.length} turns`;
  const transcriptSummarySecondary = showRunProgress
    ? activeRunMessage || activeRunStep?.label || "Starting run"
    : `${transcriptWordCount} words`;
  const runProgressCompletedSteps = activeRunStep
    ? activeRunStep.kind === "finalize"
      ? runProgressSteps.length
      : activeRunStepIndex + 1
    : 0;
  const runProgressPercent =
    runProgressSteps.length > 0
      ? (runProgressCompletedSteps / runProgressSteps.length) * 100
      : 0;

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

  const loadGitHubTree = useCallback(async (): Promise<void> => {
    setGithubBusy(true);
    setGithubError(null);

    try {
      const response = await fetch("/api/sources/github/tree", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          repoUrl: githubRepoUrl.trim(),
          ref: githubRef.trim() || undefined,
          githubToken: githubToken.trim() || undefined
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | (GitHubSourceTreeResponse & { error?: string; details?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      if (!payload || !Array.isArray(payload.nodes)) {
        throw new Error("Invalid GitHub tree response");
      }

      startTransition(() => {
        setGithubTree(payload);
      });
    } catch (githubLoadError) {
      setGithubError(toErrorMessage(githubLoadError));
    } finally {
      setGithubBusy(false);
    }
  }, [githubRef, githubRepoUrl, githubToken]);

  useEffect(() => {
    void loadModelCatalog(false);
  }, [loadModelCatalog]);

  useEffect(() => {
    if (!hasSelectedSources) {
      setSourcePack(null);
      setPreparedSourceSignature(null);
      setSourcePackError(null);
    }
  }, [hasSelectedSources]);

  async function handlePrepareSources(): Promise<void> {
    setSourcePackBusy(true);
    setSourcePackError(null);

    try {
      const formData = new FormData();

      formData.append(
        "manifest",
        JSON.stringify({
          topic: topic.trim(),
          objective: objective.trim(),
          uploadLabels: [
            ...uploadFiles.map((item) => item.label),
            ...importedRepoSelectedPaths
          ],
          workspacePaths: [],
          githubSelection: githubSelectedPaths.length
            ? {
                repoUrl: githubRepoUrl.trim(),
                ref: githubRef.trim() || undefined,
                paths: githubSelectedPaths
              }
            : null
        })
      );

      if (githubToken.trim()) {
        formData.append("githubToken", githubToken.trim());
      }

      for (const item of uploadFiles) {
        formData.append("files", item.file);
      }

      if (importedRepoTree && importedRepoSelectedPaths.length > 0) {
        for (const filepath of importedRepoSelectedPaths) {
          const handle = importedRepoTree.fileHandlesByPath[filepath];

          if (!handle) {
            throw new Error(`Imported repo file '${filepath}' is no longer available.`);
          }

          formData.append("files", await handle.getFile());
        }
      }

      const response = await fetch("/api/sources/resolve", {
        method: "POST",
        body: formData
      });
      const payload = (await response.json().catch(() => null)) as
        | (SourcePack & { error?: string; details?: string })
        | null;

      if (!response.ok) {
        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      if (!payload || !Array.isArray(payload.excerpts) || !Array.isArray(payload.files)) {
        throw new Error("Invalid source pack response");
      }

      startTransition(() => {
        setSourcePack(payload);
        setPreparedSourceSignature(currentSourceSignature);
      });
    } catch (prepareError) {
      setSourcePackError(toErrorMessage(prepareError));
    } finally {
      setSourcePackBusy(false);
    }
  }

  function handleUploadSelection(nextFiles: FileList | null): void {
    if (!nextFiles?.length) {
      return;
    }

    setUploadFiles((current) => {
      const seen = new Set(current.map((item) => item.key));
      const additions = [...nextFiles]
        .map((file) => {
          const label =
            typeof file.webkitRelativePath === "string" && file.webkitRelativePath
              ? file.webkitRelativePath
              : file.name;
          const key = toUploadKey(file, label);

          return {
            file,
            label,
            key
          };
        })
        .filter((item) => {
          if (seen.has(item.key)) {
            return false;
          }

          seen.add(item.key);
          return true;
        });

      return [...current, ...additions];
    });
  }

  async function handlePickLocalRepoFolder(): Promise<void> {
    const pickerWindow = typeof window === "undefined" ? null : (window as WindowWithDirectoryPicker);

    if (!pickerWindow || typeof pickerWindow.showDirectoryPicker !== "function") {
      setSourcePackError(
        "This browser does not support folder picking. Use Add files instead."
      );
      return;
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker();
      setImportedRepoBusy(true);
      const nextImportedRepoTree = await collectDirectoryTree(directoryHandle);

      if (Object.keys(nextImportedRepoTree.fileHandlesByPath).length === 0) {
        setSourcePackError("The selected folder did not contain readable files.");
        setImportedRepoBusy(false);
        return;
      }

      setImportedRepoTree(nextImportedRepoTree);
      setImportedRepoSelectedPaths([]);
      setImportedRepoSearch("");
      setSourcePackError(null);
    } catch (folderError) {
      if (folderError instanceof DOMException && folderError.name === "AbortError") {
        return;
      }

      setSourcePackError(toErrorMessage(folderError));
    } finally {
      setImportedRepoBusy(false);
    }
  }

  function removeUploadFile(targetFile: UploadSelection): void {
    setUploadFiles((current) =>
      current.filter((file) => file.key !== targetFile.key)
    );
  }

  async function handleRun(): Promise<void> {
    if (hasSelectedSources && (!sourcePack || sourcePackStale)) {
      setError("Prepare sources before starting the debate so the evidence pack matches the current selection.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    setLiveTranscript([]);
    setActiveRunMessage(null);

    const requestSettings: DebateSettings = {
      topic: topic.trim(),
      objective: objective.trim(),
      notes: notes.trim(),
      rounds: Math.max(1, Math.min(5, Math.trunc(rounds || defaults.rounds))),
      participantA: {
        slot: "A",
        displayName: DEFAULT_CRITIC_DISPLAY_NAME,
        modelId: participantAModel.trim(),
        rolePreset: "critic"
      },
      participantB: {
        slot: "B",
        displayName: DEFAULT_BUILDER_DISPLAY_NAME,
        modelId: participantBModel.trim(),
        rolePreset: "builder"
      },
      synthesisModel: synthesisModel.trim(),
      synthesisFormat
    };
    const activeSourcePack = hasSelectedSources ? sourcePack : null;
    const plannedRunSteps = buildRunProgressSteps(requestSettings);

    setActiveRunSettings(requestSettings);
    setActiveRunStepIndex(0);

    try {
      const response = await fetch("/api/debate", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          stream: true,
          topic: requestSettings.topic,
          objective: requestSettings.objective,
          notes: requestSettings.notes,
          rounds: requestSettings.rounds,
          participantA: {
            displayName: requestSettings.participantA.displayName,
            modelId: requestSettings.participantA.modelId,
            rolePreset: requestSettings.participantA.rolePreset
          },
          participantB: {
            displayName: requestSettings.participantB.displayName,
            modelId: requestSettings.participantB.modelId,
            rolePreset: requestSettings.participantB.rolePreset
          },
          synthesisModel: requestSettings.synthesisModel,
          synthesisFormat: requestSettings.synthesisFormat,
          apiKey: openrouterApiKey.trim() || undefined,
          sourcePack: activeSourcePack || undefined
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; details?: string }
          | null;

        throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("Streaming debate response was unavailable.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let payload: DebateRunResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed) {
            continue;
          }

          const event = JSON.parse(trimmed) as DebateStreamEvent;

          if (event.type === "status") {
            const nextStepId = getStepIdForStatusEvent(event);
            const nextStepIndex = plannedRunSteps.findIndex((step) => step.id === nextStepId);

            if (nextStepIndex >= 0) {
              setActiveRunStepIndex(nextStepIndex);
            }

            setActiveRunMessage(event.message);

            if (event.stage === "turn_complete" && event.turn) {
              setLiveTranscript((current) => [...current, event.turn as DebateTurn]);
            }

            continue;
          }

          if (event.type === "error") {
            throw new Error(event.details || event.error);
          }

          payload = event.result;
        }

        if (done) {
          if (buffer.trim()) {
            const event = JSON.parse(buffer.trim()) as DebateStreamEvent;

            if (event.type === "error") {
              throw new Error(event.details || event.error);
            }

            if (event.type === "result") {
              payload = event.result;
            }
          }

          break;
        }
      }

      if (!payload?.synthesis || !Array.isArray(payload.transcript)) {
        throw new Error("Invalid debate response");
      }

      const effectiveSettings: DebateSettings = {
        topic: requestSettings.topic,
        objective: requestSettings.objective,
        notes: requestSettings.notes,
        rounds: payload.meta.rounds,
        participantA: {
          slot: "A",
          displayName: payload.meta.participants.participantA.displayName,
          modelId: payload.meta.effectiveModels.participantA,
          rolePreset: payload.meta.participants.participantA.rolePreset
        },
        participantB: {
          slot: "B",
          displayName: payload.meta.participants.participantB.displayName,
          modelId: payload.meta.effectiveModels.participantB,
          rolePreset: payload.meta.participants.participantB.rolePreset
        },
        synthesisModel: payload.meta.effectiveModels.synthesis,
        synthesisFormat: payload.meta.synthesisFormat
      };

      startTransition(() => {
        setLastRunSettings(effectiveSettings);
        setLastRunSourcePack(activeSourcePack);
        setResult(payload);
        setLiveTranscript(payload.transcript);
      });
    } catch (runError) {
      setError(toErrorMessage(runError));
    } finally {
      setBusy(false);
      setActiveRunSettings(null);
      setActiveRunStepIndex(0);
    }
  }

  function handleSaveMarkdown(): void {
    if (!lastRunSettings || !result) {
      return;
    }

    const exportPayload = buildDebateExport({
      settings: lastRunSettings,
      result,
      sourcePack: lastRunSourcePack
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
      result,
      sourcePack: lastRunSourcePack
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
            `${getTranscriptSpeakerLabel(turn.model)} · ${turn.model} · ROUND ${turn.round}\n${sanitizeTranscriptText(turn.text)}`
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
                      The critic starts each round, the builder answers, and the synthesis model
                      writes the final working doc.
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
                      Paste a key here or use <span className="font-mono">OPENROUTER_API_KEY</span>. The UI key works even when OpenRouter is not set in env.
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
                      If no OpenRouter key is provided in the UI or env, the app falls back to
                      <span className="font-mono"> OPENAI_API_KEY</span> and
                      <span className="font-mono"> ANTHROPIC_API_KEY</span>.
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
                    Critic model
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
                          {criticSuggestedModels.map((entry) => (
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
                    Builder model
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
                          {builderSuggestedModels.map((entry) => (
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

              <label className="space-y-1 text-xs text-muted-foreground">
                Notes / context
                <textarea
                  className={textareaClassName()}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional context, constraints, or extra pressure for both roles."
                />
              </label>

              <div className="space-y-3 rounded-lg border border-border/80 bg-background/40 p-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Synthesis format
                  </p>
                  <p className="mt-1 text-sm text-foreground">
                    Choose the final writing structure. `Auto` is the default.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {SYNTHESIS_FORMAT_OPTIONS.map((option) => {
                    const selected = synthesisFormat === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={
                          selected
                            ? "rounded-full border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-100 transition-colors"
                            : "rounded-full border border-border/70 bg-background/60 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        }
                        onClick={() => setSynthesisFormat(option.id)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                <p className="text-xs text-muted-foreground">
                  {SYNTHESIS_FORMAT_OPTIONS.find((option) => option.id === synthesisFormat)
                    ?.description || "Pick a format for the final synthesis."}
                </p>
              </div>

              <div className="space-y-3 rounded-lg border border-border/80 bg-background/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Documents</p>
                    <p className="text-sm text-foreground">
                      Add uploads, a local repo, or a GitHub repo to ground the debate with cited excerpts.
                    </p>
                  </div>
                  <Badge variant="outline">
                    {hasSelectedSources
                      ? `${uploadFiles.length + importedRepoSelectedPaths.length + githubSelectedPaths.length} selected`
                      : "optional"}
                  </Badge>
                </div>

                <div className="space-y-3 rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileUp className="h-4 w-4 text-muted-foreground" />
                      Uploads
                    </div>
                    <label className="inline-flex">
                      <input
                        type="file"
                        multiple
                        accept=".c,.cc,.conf,.cpp,.cs,.css,.go,.graphql,.h,.hpp,.html,.ini,.java,.js,.json,.jsx,.kt,.kts,.less,.log,.lua,.m,.md,.mdx,.mjs,.pdf,.php,.pl,.py,.rb,.rs,.scss,.sh,.sql,.svg,.swift,.toml,.ts,.tsx,.txt,.vue,.xml,.yaml,.yml"
                        className="sr-only"
                        onChange={(event) => {
                          handleUploadSelection(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      <span className="inline-flex cursor-pointer items-center rounded-full border border-border/70 bg-background/70 px-3 py-1 text-xs text-foreground transition-colors hover:bg-background">
                        Add files
                      </span>
                    </label>
                  </div>

                  {uploadFiles.length > 0 ? (
                    <div className="space-y-2">
                      {uploadFiles.map((item) => (
                        <div
                          key={item.key}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-foreground">{item.label}</div>
                            <div className="text-muted-foreground">
                              {Math.max(1, Math.round(item.file.size / 1024))} KB
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-muted-foreground transition-colors hover:text-foreground"
                            onClick={() => removeUploadFile(item)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                      Upload Markdown, text, code, or PDF files directly when you only need a small hand-picked set.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                      Imported repo
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={importedRepoBusy}
                      onClick={() => void handlePickLocalRepoFolder()}
                    >
                      {importedRepoBusy ? (
                        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpen className="mr-2 h-4 w-4" />
                      )}
                      Load repo
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Import a local repo from your computer, then select only the files you want to send to the evidence pack.
                  </p>

                  {importedRepoTree ? (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{importedRepoTree.rootLabel}</span>
                        <span>{importedRepoSelectedPaths.length} selected</span>
                      </div>

                      <SourceTreeBrowser
                        nodes={importedRepoTree.nodes}
                        rootLabel={importedRepoTree.rootLabel}
                        selectedPaths={importedRepoSelectedPaths}
                        searchValue={importedRepoSearch}
                        onSearchChange={setImportedRepoSearch}
                        onTogglePath={(filepath) =>
                          setImportedRepoSelectedPaths((current) =>
                            togglePathSelection(current, filepath)
                          )
                        }
                        emptyLabel="No matching imported repo files."
                      />
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                      Load a local repo folder to browse and select files.
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                      <Github className="h-4 w-4 text-muted-foreground" />
                      GitHub
                    </div>
                    <Button variant="outline" size="sm" disabled={githubBusy} onClick={() => void loadGitHubTree()}>
                      {githubBusy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                      Load repo
                    </Button>
                  </div>

                  <div className="grid gap-3">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      Repo URL
                      <Input
                        value={githubRepoUrl}
                        onChange={(event) => {
                          setGithubRepoUrl(event.target.value);
                          setGithubTree(null);
                          setGithubSelectedPaths([]);
                        }}
                        placeholder="https://github.com/owner/repo"
                      />
                    </label>

                    <label className="space-y-1 text-xs text-muted-foreground">
                      Ref / branch
                      <Input
                        value={githubRef}
                        onChange={(event) => {
                          setGithubRef(event.target.value);
                          setGithubTree(null);
                          setGithubSelectedPaths([]);
                        }}
                        placeholder="main"
                      />
                    </label>

                    <label className="space-y-1 text-xs text-muted-foreground">
                      GitHub token
                      <Input
                        autoComplete="off"
                        type="password"
                        value={githubToken}
                        onChange={(event) => setGithubToken(event.target.value)}
                        placeholder="ghp_..."
                      />
                    </label>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    The UI GitHub token stays in memory only and overrides <span className="font-mono">GITHUB_TOKEN</span> for this session.
                  </p>

                  {githubError ? <p className="text-xs text-rose-300">{githubError}</p> : null}
                  {githubTree?.warnings.map((warning) => (
                    <p key={warning} className="text-xs text-amber-100/90">
                      {warning}
                    </p>
                  ))}

                  {githubTree ? (
                    <SourceTreeBrowser
                      nodes={githubTree.nodes}
                      rootLabel={`${githubTree.repo.owner}/${githubTree.repo.name}@${githubTree.repo.ref}`}
                      selectedPaths={githubSelectedPaths}
                      searchValue={githubSearch}
                      onSearchChange={setGithubSearch}
                      onTogglePath={(filepath) =>
                        setGithubSelectedPaths((current) => togglePathSelection(current, filepath))
                      }
                      emptyLabel="No matching GitHub files."
                    />
                  ) : (
                    <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                      Load a public or private GitHub repo to browse and select files.
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <Button
                    variant="outline"
                    onClick={() => void handlePrepareSources()}
                    disabled={!hasSelectedSources || sourcePackBusy}
                    className="w-full gap-2"
                  >
                    {sourcePackBusy ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    Prepare sources
                  </Button>

                  {!hasSelectedSources ? (
                    <p className="text-xs text-muted-foreground">
                      No sources selected. The debate will run on the topic and objective only.
                    </p>
                  ) : null}

                  {sourcePackError ? <p className="text-xs text-rose-300">{sourcePackError}</p> : null}

                  {sourcePack ? (
                    <SourcePackPreview
                      sourcePack={sourcePack}
                      stale={sourcePackStale}
                      sourceLabelsByFileId={preparedSourceLabelsByFileId}
                    />
                  ) : null}

                  {sourcePackStale ? (
                    <p className="text-xs text-amber-100/90">
                      Topic, objective, or source selection changed. Prepare sources again before the next run.
                    </p>
                  ) : null}
                </div>
              </div>

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

              {showRunProgress && activeRunStep ? (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-foreground">Debate in progress</div>
                    <div className="text-xs text-sky-100/90">
                      {Math.min(activeRunStepIndex + 1, runProgressSteps.length)}/{runProgressSteps.length}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/70">
                    <div
                      className="run-progress-bar h-full rounded-full"
                      style={{ width: `${runProgressPercent}%` }}
                    />
                  </div>
                  <div className="mt-3 text-sm text-foreground">{activeRunStep.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{activeRunStep.detail}</p>
                </div>
              ) : null}

              <Button
                onClick={() => void handleRun()}
                disabled={busy || sourcePackBusy || (hasSelectedSources && (!sourcePack || sourcePackStale))}
                className="w-full gap-2"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
                Run debate
              </Button>

              {error ? <p className="text-sm text-rose-300">{error}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-6 lg:sticky lg:top-8 lg:self-start">
          <Card className="border-border/80 bg-card/95">
            <CardHeader className="border-b border-border/70">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Badge variant="outline">Transcript</Badge>
                  <CardTitle className="mt-2 text-lg">Debate</CardTitle>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{transcriptSummaryPrimary}</div>
                    <div>{transcriptSummarySecondary}</div>
                  </div>
                  <Button variant="outline" size="sm" disabled={!result || showRunProgress} onClick={() => void handleCopyTranscript()}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="scroll-soft max-h-[42vh] space-y-3 overflow-auto p-4">
              {showRunProgress && activeRunSettings ? (
                <>
                  {activeRunTurnSteps.map((step) => {
                    const stepIndex = runProgressSteps.findIndex((candidate) => candidate.id === step.id);
                    const state = getRunStepState(stepIndex, activeRunStepIndex);
                    const speakerLabel = getTranscriptSpeakerLabel(step.model);
                    const completedTurn = liveTranscript.find(
                      (turn) => turn.round === step.round && turn.participant === step.participant
                    );

                    if (completedTurn) {
                      return (
                        <article
                          key={step.id}
                          className={
                            completedTurn.rolePreset === "critic"
                              ? "rounded-lg border border-sky-500/30 bg-sky-500/10 p-3"
                              : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                          }
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">
                                {getTranscriptSpeakerLabel(completedTurn.model)}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Round {completedTurn.round}</span>
                                <span>•</span>
                                <span>{completedTurn.model}</span>
                              </div>
                            </div>
                            <Badge variant="outline">done</Badge>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-6">
                            {sanitizeTranscriptText(completedTurn.text)}
                          </p>
                        </article>
                      );
                    }

                    return (
                      <article
                        key={step.id}
                        className={
                          step.participant === "A"
                            ? "rounded-lg border border-sky-500/30 bg-sky-500/10 p-3"
                            : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                        }
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {speakerLabel}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>Round {step.round}</span>
                              <span>•</span>
                              <span>{step.model}</span>
                            </div>
                          </div>
                          <Badge variant="outline">
                            {state === "active"
                              ? "thinking"
                              : state === "queued"
                                ? "queued"
                                : "up next"}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            {state === "active"
                              ? step.detail
                              : state === "queued"
                                ? "This turn is in the completed part of the run sequence. The full text will appear when the run returns."
                                : "Waiting for the previous turn before this model can answer."}
                          </p>
                          <div className="space-y-2">
                            <div className={state === "active" ? "run-skeleton-line w-full" : "run-skeleton-line-muted w-5/6"} />
                            <div className={state === "active" ? "run-skeleton-line w-11/12" : "run-skeleton-line-muted w-4/5"} />
                            <div className={state === "active" ? "run-skeleton-line w-4/5" : "run-skeleton-line-muted w-3/5"} />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </>
              ) : result ? (
                result.transcript.map((turn) => (
                  <article
                    key={`${turn.participant}-${turn.round}-${turn.model}`}
                    className={
                      turn.rolePreset === "critic"
                        ? "rounded-lg border border-sky-500/30 bg-sky-500/10 p-3"
                        : "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3"
                    }
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">
                          {getTranscriptSpeakerLabel(turn.model)}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Round {turn.round}</span>
                          <span>•</span>
                          <span>{turn.model}</span>
                        </div>
                      </div>
                      <Badge variant="outline">
                        {getTranscriptSpeakerLabel(turn.model)}
                      </Badge>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6">
                      {sanitizeTranscriptText(turn.text)}
                    </p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border/80 bg-background/40 p-6 text-sm text-muted-foreground">
                  The transcript appears here turn by turn, with the selected models responding
                  against the full transcript so far.
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
                      disabled={!workingDoc || showRunProgress}
                      onClick={() => void copyText(workingDoc)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                    <Button variant="outline" size="sm" disabled={!result || showRunProgress} onClick={handleSaveMarkdown}>
                      <FileDown className="mr-2 h-4 w-4" />
                      Save .md
                    </Button>
                    <Button variant="outline" size="sm" disabled={!result || showRunProgress} onClick={handleSaveJson}>
                      <FileText className="mr-2 h-4 w-4" />
                      Save .json
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-4">
                {showRunProgress && activeRunSettings ? (
                  <div className="rounded-lg border border-dashed border-border/80 bg-background/40 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">
                          {activeRunLanguage === "fr"
                            ? "Synthese en cours"
                            : "Working doc in progress"}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {activeRunLanguage === "fr"
                            ? "La synthese commence apres le dernier tour et se redige a partir du transcript complet."
                            : "The synthesis starts after the final round and is written from the full transcript."}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {activeRunStep?.kind === "synthesis" || activeRunStep?.kind === "finalize"
                          ? activeRunLanguage === "fr"
                            ? "redaction"
                            : "drafting"
                          : activeRunLanguage === "fr"
                            ? "en attente"
                            : "waiting"}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-3">
                      {activeRunSynthesisSections.map((sectionTitle, index) => {
                        const unlocked =
                          activeRunStep?.kind === "synthesis" || activeRunStep?.kind === "finalize";

                        return (
                          <div
                            key={sectionTitle}
                            className="rounded-lg border border-border/70 bg-background/60 p-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                {sectionTitle}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {unlocked
                                  ? index === 0
                                    ? activeRunLanguage === "fr"
                                      ? "ouverture"
                                      : "opening"
                                    : activeRunLanguage === "fr"
                                      ? "redaction"
                                      : "drafting"
                                  : activeRunLanguage === "fr"
                                    ? "en attente"
                                    : "pending"}
                              </div>
                            </div>
                            <div className="mt-3 space-y-2">
                              <div className={unlocked ? "run-skeleton-line w-full" : "run-skeleton-line-muted w-10/12"} />
                              <div className={unlocked ? "run-skeleton-line w-5/6" : "run-skeleton-line-muted w-2/3"} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : result ? (
                  <div className="scroll-soft max-h-[70vh] overflow-auto rounded-lg border border-border/80 bg-background/60 p-4 text-sm text-foreground">
                    <MarkdownRenderer content={workingDoc} />
                  </div>
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
                    {showRunProgress && activeRunStep
                      ? `Run in progress. ${activeRunStep.label}.`
                      : result
                      ? `Provider mode: ${result.meta.provider}. Exactly two participants, one synthesis, and sanitized exports.`
                      : "No completed run yet. Defaults are loaded from the environment until you start a debate."}
                  </p>

                  {showRunProgress && activeRunStep ? (
                    <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-foreground">
                      <div className="font-medium">Current step</div>
                      <div className="mt-1 text-muted-foreground">{activeRunStep.detail}</div>
                    </div>
                  ) : null}

                  <div className="rounded-lg border border-border/80 bg-background/50 p-3 text-xs text-foreground">
                    <div className="font-medium">Models in scope</div>
                    <div className="mt-1 text-muted-foreground">
                      {currentParticipants.participantA.displayName}: {currentModels.participantA}
                      <br />
                      {currentParticipants.participantB.displayName}: {currentModels.participantB}
                      <br />
                      Synthesis: {currentModels.synthesis}
                      <br />
                      Format: {getSynthesisFormatLabel(currentSynthesisFormat)}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-background/50 p-3 text-xs text-foreground">
                    <div className="font-medium">Documents in scope</div>
                    <div className="mt-1 text-muted-foreground">
                      {result?.meta.sourceSummary
                        ? `${result.meta.sourceSummary.totalFiles} files · ${result.meta.sourceSummary.totalExcerpts} selected passages · ${result.meta.sourceSummary.origins.join(", ")}`
                        : sourcePack
                          ? `${sourcePack.files.length} files prepared · ${sourcePack.excerpts.length} selected passages`
                          : "No prepared document pack."}
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
